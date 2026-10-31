import { z } from 'zod';
import type { NormalizedMessage, ProviderState, ToolCall, ToolResultContent } from '../llm/provider.js';
import type { StepRow } from './persistence.js';

/**
 * Shapes of what each step type stores in agent_steps.input / .output. Persisted JSON is
 * validated on the way back in: resume must never act on a corrupted or outdated row.
 */
const ToolCallSchema = z.object({ id: z.string(), name: z.string(), input: z.unknown() });

export const LlmStepOutput = z.object({
  stopReason: z.enum(['tool_use', 'end_turn', 'max_tokens', 'error']),
  text: z.string().optional(),
  toolCalls: z.array(ToolCallSchema),
  providerState: z
    .object({ provider: z.enum(['anthropic', 'nebius', 'fake']), model: z.string(), data: z.unknown() })
    .optional(),
  errorMessage: z.string().optional(),
  raw: z.unknown().optional(),
});
export type LlmStepOutput = z.infer<typeof LlmStepOutput>;

export const ToolStepInput = z.object({ toolCallId: z.string(), input: z.unknown() });
export const ToolStepOutput = z.object({
  ref: z.string(),
  ok: z.boolean(),
  output: z.unknown().optional(),
  error: z.unknown().optional(),
  durationMs: z.number(),
});
export type ToolStepOutput = z.infer<typeof ToolStepOutput>;

export const RepairStepOutput = z.object({ message: z.string() });

export type Pending =
  | { kind: 'tools'; toolCalls: ToolCall[]; results: Map<string, ToolResultContent> }
  | { kind: 'final'; text: string | undefined; truncated: boolean }
  | null;

export interface LoopState {
  messages: NormalizedMessage[];
  pending: Pending;
  nextStep: number;
  llmCalls: number;
  repairs: number;
}

export const stepRef = (stepNumber: number) => `step_${stepNumber}`;

/** The exact text the model receives for a tool result. */
export function toolResultContent(call: ToolCall, out: ToolStepOutput): ToolResultContent {
  return {
    toolCallId: call.id,
    toolName: call.name,
    content: JSON.stringify(out.ok ? { ref: out.ref, result: out.output } : { ref: out.ref, error: out.error }),
    isError: !out.ok,
  };
}

/** What to do after an LLM turn, decided from its stop reason. */
export function pendingFor(out: LlmStepOutput): Pending {
  if (out.toolCalls.length > 0 && out.stopReason === 'tool_use') {
    return { kind: 'tools', toolCalls: out.toolCalls, results: new Map() };
  }
  return { kind: 'final', text: out.text, truncated: out.stopReason === 'max_tokens' };
}

export function assistantMessage(out: LlmStepOutput): NormalizedMessage {
  return {
    role: 'assistant',
    ...(out.text !== undefined ? { text: out.text } : {}),
    toolCalls: out.toolCalls,
    ...(out.providerState ? { providerState: out.providerState as ProviderState } : {}),
  };
}

function flushTools(state: LoopState): void {
  const p = state.pending;
  if (p?.kind === 'tools' && p.toolCalls.every((c) => p.results.has(c.id))) {
    state.messages.push({ role: 'tool_results', results: p.toolCalls.map((c) => p.results.get(c.id) as ToolResultContent) });
    state.pending = null;
  }
}

/**
 * Replays persisted steps into the in-memory loop state. The live loop appends messages in
 * the same order, so a resumed conversation is byte-for-byte the one the model saw before
 * (which matters: Claude rejects replayed thinking blocks if earlier turns change).
 * Tool calls that already have a persisted result are never executed again.
 */
export function rebuildState(question: string, steps: StepRow[]): LoopState {
  const state: LoopState = { messages: [{ role: 'user', content: question }], pending: null, nextStep: 1, llmCalls: 0, repairs: 0 };

  for (const step of steps) {
    state.nextStep = Math.max(state.nextStep, step.stepNumber + 1);
    switch (step.type) {
      case 'llm_call': {
        flushTools(state);
        const out = LlmStepOutput.parse(step.output);
        state.llmCalls++;
        state.messages.push(assistantMessage(out));
        state.pending = out.stopReason === 'error' ? null : pendingFor(out);
        break;
      }
      case 'tool_call': {
        const p = state.pending;
        if (p?.kind !== 'tools') throw new Error(`Step ${step.stepNumber}: tool result without a pending tool call`);
        const { toolCallId } = ToolStepInput.parse(step.input);
        const call = p.toolCalls.find((c) => c.id === toolCallId);
        if (!call) throw new Error(`Step ${step.stepNumber}: unknown tool call id ${toolCallId}`);
        p.results.set(toolCallId, toolResultContent(call, ToolStepOutput.parse(step.output)));
        break;
      }
      case 'repair': {
        state.repairs++;
        state.messages.push({ role: 'user', content: RepairStepOutput.parse(step.output).message });
        state.pending = null;
        break;
      }
    }
  }
  flushTools(state);
  return state;
}
