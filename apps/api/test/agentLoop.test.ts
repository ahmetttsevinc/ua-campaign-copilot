import type { AgentRun, FinalAnswer } from '@copilot/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../src/agent/events.js';
import { type AgentDeps, executeRun, isResumable, RunAlreadyActiveError, startRun } from '../src/agent/loop.js';
import { loadRun } from '../src/agent/persistence.js';
import { PROMPT_VERSION, SYSTEM_PROMPT } from '../src/agent/prompts.js';
import { resumeRun, RunNotResumableError } from '../src/agent/resume.js';
import { agentRuns, agentSteps } from '../src/db/schema.js';
import { LAST_7, PREV_7 } from '../src/db/seed/scenarios.js';
import { FakeProvider, type FakeScriptEntry, fakeFinalTurn, fakeToolCall, fakeToolTurn } from '../src/llm/fake.js';
import { ProviderHttpError } from '../src/llm/provider.js';
import { createFraudStore, type FraudStore } from '../src/sources/fraudCsv/loader.js';
import { TEST_DATA_DIR } from './helpers.js';
import { startHarness, type Harness } from './toolHarness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const compareCall = (id = 'call_compare') =>
  fakeToolCall('compare_campaign_periods', { before: PREV_7, after: LAST_7, limit: 3 }, id);
const fraudCall = (id = 'call_fraud') => fakeToolCall('get_fraud_signals', { campaignIds: ['cmp_007'], period: LAST_7 }, id);

const goodAnswer: FinalAnswer = {
  summary: 'cmp_007 ROAS halved because of click injection.',
  findings: [
    { campaignId: 'cmp_007', campaignName: 'Tile Tide | US | Android', metric: 'roas', before: 0.9318, after: 0.4738, changePct: -49.2, likelyCause: 'Click injection', evidence: ['step_2', 'step_4'] },
  ],
  caveats: [],
  confidence: 'high',
};

/** Counts fraud CSV reads so tests can prove a tool was not re-executed. */
function countingFraud(): FraudStore & { reads: number } {
  const inner = createFraudStore(TEST_DATA_DIR);
  const store = { reads: 0, rows: () => (store.reads++, inner.rows()) };
  return store;
}

function deps(provider: FakeProvider, overrides: Partial<AgentDeps> = {}): AgentDeps {
  return {
    db: h.db,
    provider,
    toolCtx: h.ctx,
    events: new EventBus(),
    budget: { maxSteps: 10, maxTokens: 50_000, maxWallMs: 90_000 },
    toolTimeoutMs: 5000,
    retry: { maxAttempts: 3, baseDelayMs: 1, sleep: async () => undefined },
    ...overrides,
  };
}

async function run(script: FakeScriptEntry[], overrides: Partial<AgentDeps> = {}, question = 'Why did cmp_007 ROAS drop?') {
  const provider = new FakeProvider(script);
  const d = deps(provider, overrides);
  const { runId, done } = await startRun(d, question);
  await done;
  const result = (await loadRun(h.db, runId, isResumable)) as AgentRun;
  return { run: result, provider, deps: d };
}

const toolSteps = (r: AgentRun) => r.steps.filter((s) => s.type === 'tool_call');

describe('agent loop: happy path', () => {
  it('calls tools, persists every step with totals and returns a grounded answer', async () => {
    const { run: r, provider } = await run([fakeToolTurn(compareCall()), fakeToolTurn(fraudCall()), fakeFinalTurn(goodAnswer)]);
    expect(r.status).toBe('completed');
    expect(r.steps.map((s) => `${s.stepNumber}:${s.type}${s.toolName ? `:${s.toolName}` : ''}`)).toEqual([
      '1:llm_call',
      '2:tool_call:compare_campaign_periods',
      '3:llm_call',
      '4:tool_call:get_fraud_signals',
      '5:llm_call',
    ]);
    expect(r.finalAnswer).toEqual(goodAnswer);
    expect(r).toMatchObject({ provider: 'fake', model: 'fake', promptVersion: PROMPT_VERSION, totalInputTokens: 300, totalOutputTokens: 60, retries: 0, repairs: 0 });
    // fake pricing: $1 / $2 per MTok -> 3 * (100 * 1 + 20 * 2) / 1e6
    expect(r.totalCostUsd).toBeCloseTo(0.00042, 8);
    expect(r.completedAt).not.toBeNull();

    // What the model saw: system prompt, 6 tools, and tool results carrying their step refs.
    const second = provider.requests[1];
    expect(second?.system).toBe(SYSTEM_PROMPT);
    expect(second?.tools).toHaveLength(6);
    const last = second?.messages.at(-1);
    expect(last?.role).toBe('tool_results');
    if (last?.role !== 'tool_results') return;
    expect(JSON.parse(last.results[0]?.content ?? '{}')).toMatchObject({ ref: 'step_2', result: { rows: expect.any(Array) } });
  });

  it('emits run and step events in order', async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const provider = new FakeProvider([fakeToolTurn(compareCall()), fakeFinalTurn(goodAnswer)]);
    const d = deps(provider, { events: bus });
    const { runId, done } = await startRun(d, 'q');
    bus.subscribe(runId, (e) => seen.push(e.type === 'step_completed' ? `done:${e.step.stepNumber}` : e.type === 'step_started' ? `start:${e.stepNumber}` : e.type));
    await done;
    expect(seen).toEqual(['run_started', 'start:1', 'done:1', 'start:2', 'done:2', 'start:3', 'done:3', 'run_completed']);
  });

  it('runs parallel tool calls from one turn as separate steps and returns results in one message', async () => {
    const { run: r, provider } = await run([fakeToolTurn(compareCall('a'), fraudCall('b')), fakeFinalTurn(goodAnswer)]);
    expect(r.status).toBe('completed');
    expect(toolSteps(r).map((s) => [s.stepNumber, s.toolName])).toEqual([
      [2, 'compare_campaign_periods'],
      [3, 'get_fraud_signals'],
    ]);
    const msg = provider.requests[1]?.messages.at(-1);
    expect(msg?.role === 'tool_results' && msg.results.map((x) => x.toolCallId)).toEqual(['a', 'b']);
  });
});

describe('agent loop: tool failures are fed back to the model', () => {
  it('invalid tool input becomes an error tool result, and the run continues', async () => {
    const { run: r, provider } = await run([
      fakeToolTurn(fakeToolCall('compare_campaign_periods', { before: { from: '2026-10-25', to: '2026-10-19' } }, 'bad')),
      fakeToolTurn(compareCall()),
      fakeFinalTurn(goodAnswer),
    ]);
    expect(r.status).toBe('completed');
    const bad = r.steps[1];
    expect(bad).toMatchObject({ type: 'tool_call', isError: true, output: { ok: false, error: { code: 'invalid_input' } } });
    const fed = provider.requests[1]?.messages.at(-1);
    expect(fed?.role === 'tool_results' && fed.results[0]).toMatchObject({ isError: true, content: expect.stringContaining('invalid_input') });
  });

  it('unknown tools and tool exceptions do not crash the run', async () => {
    const broken: FraudStore = { rows: () => Promise.reject(new Error('vendor file corrupted')) };
    const { run: r } = await run(
      [fakeToolTurn(fakeToolCall('drop_tables', {}, 'x'), fraudCall('y')), fakeFinalTurn({ ...goodAnswer, findings: [] })],
      { toolCtx: { ...h.ctx, fraud: broken } },
    );
    expect(r.status).toBe('completed');
    expect(toolSteps(r).map((s) => (s.output as { error: { code: string } }).error.code)).toEqual(['unknown_tool', 'execution_error']);
  });
});

describe('agent loop: final answer repair', () => {
  it('repairs invalid final JSON once and completes', async () => {
    const { run: r, provider } = await run([
      fakeToolTurn(compareCall()),
      fakeFinalTurn('ROAS dropped a lot for cmp_007, mostly fraud.'),
      fakeFinalTurn(`\`\`\`json\n${JSON.stringify({ ...goodAnswer, findings: [{ ...goodAnswer.findings[0], evidence: ['step_2'] }] })}\n\`\`\``),
    ]);
    expect(r.status).toBe('completed');
    expect(r.repairs).toBe(1);
    expect(r.steps.map((s) => s.type)).toEqual(['llm_call', 'tool_call', 'llm_call', 'repair', 'llm_call']);
    const repairPrompt = provider.requests[2]?.messages.at(-1);
    expect(repairPrompt).toMatchObject({ role: 'user', content: expect.stringContaining('No JSON object found') });
  });

  it('gives up after 2 repairs with failed_validation and keeps the raw text, never an answer', async () => {
    const { run: r } = await run([
      fakeFinalTurn('nope'),
      fakeFinalTurn('{"summary": "x"}'),
      fakeFinalTurn('{"summary": "x", "findings": [], "caveats": [], "confidence": "certain"}'),
    ]);
    expect(r.status).toBe('failed_validation');
    expect(r.repairs).toBe(2);
    expect(r.finalAnswer).toBeNull();
    expect(r.error).toMatch(/confidence/);
    expect(r.error).toContain('"confidence": "certain"');
    expect(r.resumable).toBe(false);
  });
});

describe('agent loop: grounding', () => {
  it('downgrades confidence when the answer cites numbers no tool returned', async () => {
    const invented = { ...goodAnswer, findings: [{ ...goodAnswer.findings[0], before: 1.25 }] } as FinalAnswer;
    const { run: r } = await run([fakeToolTurn(compareCall()), fakeFinalTurn(invented)]);
    expect(r.status).toBe('completed');
    expect(r.finalAnswer?.confidence).toBe('low');
    expect(r.finalAnswer?.caveats.at(-1)).toMatch(/cmp_007 before=1.25/);
  });
});

describe('agent loop: budgets', () => {
  const forever: FakeScriptEntry = () => fakeToolTurn(fakeToolCall('list_campaigns', { status: 'paused' }));

  it('stops at max steps', async () => {
    const { run: r, provider } = await run([forever, forever, forever], { budget: { maxSteps: 2, maxTokens: 50_000, maxWallMs: 90_000 } });
    expect(r.status).toBe('max_steps_exceeded');
    expect(provider.callCount).toBe(2);
    expect(r.error).toMatch(/2 LLM steps/);
  });

  it('stops when the token budget is spent', async () => {
    const { run: r, provider } = await run([forever, forever, forever], { budget: { maxSteps: 10, maxTokens: 150, maxWallMs: 90_000 } });
    expect(r.status).toBe('budget_exceeded');
    expect(provider.callCount).toBe(2);
    expect(r.error).toMatch(/Token budget/);
  });

  it('stops when the time budget is spent', async () => {
    const { run: r } = await run([{ ...fakeToolTurn(compareCall()), delayMs: 30 }, forever], { budget: { maxSteps: 10, maxTokens: 50_000, maxWallMs: 20 } });
    expect(r.status).toBe('budget_exceeded');
    expect(r.error).toMatch(/Time budget/);
  });
});

describe('agent loop: provider failures', () => {
  it('retries transient provider errors and records the retry count', async () => {
    const { run: r } = await run([{ throws: new ProviderHttpError('overloaded', 529) }, fakeToolTurn(compareCall()), fakeFinalTurn(goodAnswer)]);
    expect(r.status).toBe('completed');
    expect(r.retries).toBe(1);
    expect(r.steps[0]?.input).toMatchObject({ retries: 1, retryErrors: ['HTTP 529: overloaded'] });
  });

  it('fails the run on a non-retryable error and leaves it resumable', async () => {
    const { run: r } = await run([{ throws: new ProviderHttpError('invalid x-api-key', 401) }]);
    expect(r).toMatchObject({ status: 'failed', error: 'HTTP 401: invalid x-api-key', resumable: true });
  });

  it('fails the run when the provider returns an unusable turn', async () => {
    const { run: r } = await run([{ stopReason: 'error', errorMessage: 'Model declined the request (refusal)' }]);
    expect(r).toMatchObject({ status: 'failed', error: 'Provider error: Model declined the request (refusal)' });
  });
});

describe('resume', () => {
  class SimulatedCrash extends Error {}

  it('continues a crashed run from the last persisted step without re-running completed tools', async () => {
    const fraud = countingFraud();
    const toolCtx = { ...h.ctx, fraud };
    // Crash right after step 3 (second LLM call, which asked for the fraud tool) is persisted.
    const crashing = await run([fakeToolTurn(compareCall()), fakeToolTurn(fraudCall())], {
      toolCtx,
      afterStep: (s) => {
        if (s.stepNumber === 3) throw new SimulatedCrash('Simulated crash after step 3');
      },
    });
    expect(crashing.run).toMatchObject({ status: 'failed', error: 'Simulated crash after step 3', resumable: true });
    expect(crashing.run.steps).toHaveLength(3);
    expect(fraud.reads).toBe(0);

    const provider = new FakeProvider([fakeFinalTurn(goodAnswer)]);
    const { done } = await resumeRun(deps(provider, { toolCtx }), crashing.run.id);
    await done;
    const r = (await loadRun(h.db, crashing.run.id, isResumable)) as AgentRun;

    expect(r.status).toBe('completed');
    expect(r.steps.map((s) => `${s.stepNumber}:${s.toolName ?? s.type}`)).toEqual([
      '1:llm_call',
      '2:compare_campaign_periods',
      '3:llm_call',
      '4:get_fraud_signals',
      '5:llm_call',
    ]);
    expect(toolSteps(r).filter((s) => s.toolName === 'compare_campaign_periods')).toHaveLength(1);
    expect(fraud.reads).toBe(1);
    // The resumed model call saw the full rebuilt history.
    expect(provider.requests[0]?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool_results', 'assistant', 'tool_results']);
    expect(r.finalAnswer).toEqual(goodAnswer);
  });

  it('only executes the missing call when a parallel batch was interrupted', async () => {
    const fraud = countingFraud();
    const toolCtx = { ...h.ctx, fraud };
    const first = await run([fakeToolTurn(compareCall('p1'), fraudCall('p2')), fakeFinalTurn(goodAnswer)], { toolCtx });
    expect(first.run.status).toBe('completed');
    // Rewind to "crashed after only the compare result was saved".
    const fraudStep = first.run.steps.find((s) => s.toolName === 'get_fraud_signals');
    await h.db.delete(agentSteps).where(eq(agentSteps.id, fraudStep?.id ?? ''));
    await h.db.delete(agentSteps).where(eq(agentSteps.id, first.run.steps.at(-1)?.id ?? ''));
    await h.db.update(agentRuns).set({ status: 'failed', finalAnswer: null }).where(eq(agentRuns.id, first.run.id));
    const readsBefore = fraud.reads;

    const provider = new FakeProvider([fakeFinalTurn(goodAnswer)]);
    await (await resumeRun(deps(provider, { toolCtx }), first.run.id)).done;
    const r = (await loadRun(h.db, first.run.id, isResumable)) as AgentRun;

    expect(r.status).toBe('completed');
    expect(fraud.reads - readsBefore).toBe(1);
    expect(toolSteps(r).map((s) => s.toolName)).toEqual(['compare_campaign_periods', 'get_fraud_signals']);
    const resent = provider.requests[0]?.messages.at(-1);
    expect(resent?.role === 'tool_results' && resent.results.map((x) => x.toolCallId)).toEqual(['p1', 'p2']);
  });

  it('resumes into the repair flow when the crash came after an invalid final answer', async () => {
    const crashing = await run([fakeFinalTurn('not json')], {
      afterStep: (s) => {
        if (s.stepNumber === 1) throw new SimulatedCrash('crash');
      },
    });
    const provider = new FakeProvider([fakeFinalTurn({ ...goodAnswer, findings: [] })]);
    await (await resumeRun(deps(provider), crashing.run.id)).done;
    const r = (await loadRun(h.db, crashing.run.id, isResumable)) as AgentRun;
    expect(r.status).toBe('completed');
    expect(r.steps.map((s) => s.type)).toEqual(['llm_call', 'repair', 'llm_call']);
  });

  it('refuses to resume completed runs or runs that are still executing', async () => {
    const { run: done } = await run([fakeFinalTurn({ ...goodAnswer, findings: [] })]);
    await expect(resumeRun(deps(new FakeProvider([])), done.id)).rejects.toBeInstanceOf(RunNotResumableError);

    const slow = new FakeProvider([{ ...fakeFinalTurn({ ...goodAnswer, findings: [] }), delayMs: 50 }]);
    const { runId, done: running } = await startRun(deps(slow), 'q');
    await expect(executeRun(deps(slow), runId)).rejects.toBeInstanceOf(RunAlreadyActiveError);
    await expect(resumeRun(deps(slow), runId)).rejects.toBeInstanceOf(RunNotResumableError);
    await running;
  });
});
