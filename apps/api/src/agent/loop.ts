import type { FinalAnswer, ProviderName, RunStatus } from '@copilot/shared';
import type { Db } from '../db/client.js';
import { costUsd } from '../llm/pricing.js';
import type { LLMProvider } from '../llm/provider.js';
import { RetryExhaustedError, withRetry } from '../llm/retry.js';
import { toolDefinitions } from '../tools/definitions.js';
import { runTool } from '../tools/index.js';
import type { ToolEnv } from '../tools/types.js';
import { type Budget, checkBudget } from './budget.js';
import type { EventBus } from './events.js';
import { applyDataGapCheck } from './dataGaps.js';
import { applyGroundingCheck } from './grounding.js';
import {
  addRetries,
  appendStep,
  createRun,
  finishRun,
  getRunRow,
  getStepRows,
  loadRun,
  type NewStep,
  type RunRow,
  type StepRow,
  toRunSummary,
  toStep,
} from './persistence.js';
import { PROMPT_VERSION, SYSTEM_PROMPT } from './prompts.js';
import { MAX_REPAIRS, parseFinalAnswer, repairMessage } from './repair.js';
import {
  assistantMessage,
  type LlmStepOutput,
  type LoopState,
  pendingFor,
  rebuildState,
  stepRef,
  ToolStepOutput,
  toolResultContent,
} from './state.js';

// Room for adaptive thinking plus a findings JSON; far above what a normal turn uses.
const MAX_OUTPUT_TOKENS = 8000;

export interface AgentDeps {
  db: Db;
  provider: LLMProvider;
  toolCtx: ToolEnv;
  events: EventBus;
  budget: Budget;
  toolTimeoutMs: number;
  retry: { maxAttempts: number; baseDelayMs: number; sleep?: (ms: number) => Promise<void> };
  /** Called after every persisted step. KILL_AFTER_STEP and crash tests hook in here. */
  afterStep?: (step: StepRow) => void | Promise<void>;
}

type Outcome = { status: Exclude<RunStatus, 'running'>; finalAnswer?: FinalAnswer; error?: string };

/** Runs currently executing in this process; a run in this set must not be resumed. */
export const activeRuns = new Set<string>();

export class RunAlreadyActiveError extends Error {}

export function isResumable(run: RunRow): boolean {
  return run.status === 'failed' || (run.status === 'running' && !activeRuns.has(run.id));
}

export async function startRun(deps: AgentDeps, question: string): Promise<{ runId: string; done: Promise<void> }> {
  const run = await createRun(deps.db, {
    question,
    provider: deps.provider.name satisfies ProviderName,
    model: deps.provider.model,
    promptVersion: PROMPT_VERSION,
  });
  return { runId: run.id, done: executeRun(deps, run.id) };
}

/**
 * Drives a run from whatever is persisted: nothing (new run) or a partial history (resume).
 * Never throws; every failure ends as a persisted run status plus a run_failed event.
 */
export async function executeRun(deps: AgentDeps, runId: string): Promise<void> {
  if (activeRuns.has(runId)) throw new RunAlreadyActiveError(`Run ${runId} is already executing`);
  activeRuns.add(runId);
  const started = performance.now();
  let outcome: Outcome;
  try {
    const run = await getRunRow(deps.db, runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    deps.events.emit({ type: 'run_started', runId, run: toRunSummary(run) });
    const steps = await getStepRows(deps.db, runId);
    const state = rebuildState(run.question, steps);
    const marks: ExecutionMarks = { resumedAfterStep: steps.length ? (steps.at(-1)?.stepNumber ?? null) : null };
    outcome = await drive(deps, run, state, started, marks);
  } catch (err) {
    outcome = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }

  try {
    await finishRun(deps.db, runId, { ...outcome, activeMs: performance.now() - started });
  } finally {
    activeRuns.delete(runId);
  }
  const final = await loadRun(deps.db, runId, isResumable);
  if (final) deps.events.emit({ type: outcome.status === 'completed' ? 'run_completed' : 'run_failed', runId, run: final });
}

/** Per-execution bookkeeping that is not part of the conversation itself. */
interface ExecutionMarks {
  /** Set when this execution resumed a run; stamped onto the first step it persists. */
  resumedAfterStep: number | null;
}

async function persist(deps: AgentDeps, marks: ExecutionMarks, step: NewStep, extra?: { retries?: number }): Promise<void> {
  if (marks.resumedAfterStep !== null) {
    // Lets the trace show exactly where a resumed run picked up.
    step = { ...step, input: { ...(step.input as object), resumedAfterStep: marks.resumedAfterStep } };
    marks.resumedAfterStep = null;
  }
  const row = await appendStep(deps.db, step, extra);
  const run = await getRunRow(deps.db, step.runId);
  if (run) deps.events.emit({ type: 'step_completed', runId: step.runId, step: toStep(row), run: toRunSummary(run) });
  await deps.afterStep?.(row);
}

async function drive(deps: AgentDeps, run: RunRow, state: LoopState, started: number, marks: ExecutionMarks): Promise<Outcome> {
  const tools = toolDefinitions();
  let totalTokens = run.totalInputTokens + run.totalOutputTokens;

  for (;;) {
    // 1. Finish whatever the last LLM turn asked for (also the entry point after a resume).
    if (state.pending?.kind === 'tools') {
      await executePendingTools(deps, marks, run.id, state);
      continue;
    }
    if (state.pending?.kind === 'final') {
      const outcome = await handleFinal(deps, marks, run.id, state);
      if (outcome) return outcome;
      continue;
    }

    // 2. Budget check before every LLM call.
    const verdict = checkBudget(deps.budget, { llmCalls: state.llmCalls, totalTokens, elapsedMs: performance.now() - started });
    if (verdict) return { status: verdict.status, error: verdict.reason };

    // 3. Call the model.
    const stepNumber = state.nextStep++;
    deps.events.emit({ type: 'step_started', runId: run.id, stepNumber, stepType: 'llm_call', toolName: null });
    let result;
    try {
      result = await withRetry(
        () => deps.provider.chat({ system: SYSTEM_PROMPT, messages: state.messages, tools, maxTokens: MAX_OUTPUT_TOKENS, temperature: 0 }),
        { ...deps.retry },
      );
    } catch (err) {
      if (err instanceof RetryExhaustedError) await addRetries(deps.db, run.id, err.attempts - 1);
      throw err;
    }
    const response = result.value;

    const out: LlmStepOutput = {
      stopReason: response.stopReason,
      ...(response.text !== undefined ? { text: response.text } : {}),
      toolCalls: response.toolCalls,
      ...(response.providerState ? { providerState: response.providerState } : {}),
      ...(response.errorMessage ? { errorMessage: response.errorMessage } : {}),
      raw: response.raw,
    };
    // Persist before acting on the response: a crash from here on is resumable.
    await persist(
      deps,
      marks,
      {
        runId: run.id,
        stepNumber,
        type: 'llm_call',
        input: { messageCount: state.messages.length, retries: result.retries, retryErrors: result.retryErrors },
        output: out,
        isError: response.stopReason === 'error',
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costUsd: costUsd(deps.provider.model, response.usage),
        latencyMs: response.latencyMs,
      },
      { retries: result.retries },
    );
    state.llmCalls++;
    totalTokens += response.usage.inputTokens + response.usage.outputTokens;

    if (response.stopReason === 'error') {
      return { status: 'failed', error: `Provider error: ${response.errorMessage ?? 'unknown'}` };
    }
    state.messages.push(assistantMessage(out));
    state.pending = pendingFor(out);
  }
}

async function executePendingTools(deps: AgentDeps, marks: ExecutionMarks, runId: string, state: LoopState): Promise<void> {
  const pending = state.pending;
  if (pending?.kind !== 'tools') return;
  // Only calls without a persisted result run; after a resume this skips completed ones.
  const todo = pending.toolCalls.filter((c) => !pending.results.has(c.id)).map((call) => ({ call, stepNumber: state.nextStep++ }));

  await Promise.all(
    todo.map(async ({ call, stepNumber }) => {
      deps.events.emit({ type: 'step_started', runId, stepNumber, stepType: 'tool_call', toolName: call.name });
      const res = await runTool(call.name, call.input, deps.toolCtx, deps.toolTimeoutMs);
      const out: ToolStepOutput = {
        ref: stepRef(stepNumber),
        ok: res.ok,
        ...(res.ok ? { output: res.output } : { error: res.error }),
        durationMs: res.durationMs,
      };
      await persist(deps, marks, {
        runId,
        stepNumber,
        type: 'tool_call',
        toolName: call.name,
        input: { toolCallId: call.id, input: call.input },
        output: out,
        isError: !res.ok,
        latencyMs: res.durationMs,
      });
      pending.results.set(call.id, toolResultContent(call, out));
    }),
  );

  state.messages.push({ role: 'tool_results', results: pending.toolCalls.map((c) => pending.results.get(c.id)).filter((r) => r !== undefined) });
  state.pending = null;
}

async function handleFinal(deps: AgentDeps, marks: ExecutionMarks, runId: string, state: LoopState): Promise<Outcome | null> {
  const pending = state.pending;
  if (pending?.kind !== 'final') return null;
  const parsed = parseFinalAnswer(pending.text);

  if (parsed.ok) {
    // Both guardrails use every tool step of the run, including those from before a resume.
    const toolSteps = (await getStepRows(deps.db, runId)).filter((s) => s.type === 'tool_call');
    const toolOutputs = toolSteps.filter((s) => !s.isError).map((s) => ToolStepOutput.parse(s.output).output);
    const grounded = applyGroundingCheck(parsed.answer, toolOutputs).answer;
    return { status: 'completed', finalAnswer: applyDataGapCheck(grounded, toolSteps).answer };
  }

  if (state.repairs >= MAX_REPAIRS) {
    // Never show unvalidated output as an answer; keep the raw text for debugging and the UI warning.
    return {
      status: 'failed_validation',
      error: `Final answer still invalid after ${MAX_REPAIRS} repair attempts: ${parsed.errors.join('; ')}\n\nRaw model output:\n${pending.text ?? ''}`,
    };
  }

  const message = repairMessage(parsed.errors, pending.truncated);
  const stepNumber = state.nextStep++;
  deps.events.emit({ type: 'step_started', runId, stepNumber, stepType: 'repair', toolName: null });
  await persist(deps, marks, {
    runId,
    stepNumber,
    type: 'repair',
    input: { attempt: state.repairs + 1, errors: parsed.errors },
    output: { message },
    isError: true,
    latencyMs: 0,
  });
  state.repairs++;
  state.messages.push({ role: 'user', content: message });
  state.pending = null;
  return null;
}
