import type { AgentRun, AgentStep } from '@copilot/shared';
import type { RunView } from '../src/lib/runState';

export const step = (n: number, over: Partial<AgentStep> = {}): AgentStep => ({
  id: `s${n}`,
  runId: 'r1',
  stepNumber: n,
  type: 'tool_call',
  toolName: 'compare_campaign_periods',
  input: { toolCallId: `c${n}`, input: { limit: 3 } },
  output: { ref: `step_${n}`, ok: true, output: { rows: [] }, durationMs: 5 },
  isError: false,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  latencyMs: 5,
  createdAt: '2026-10-31T10:00:00.000Z',
  ...over,
});

export const llmStep = (n: number, output: object, over: Partial<AgentStep> = {}): AgentStep =>
  step(n, { type: 'llm_call', toolName: null, input: { retries: 0, retryErrors: [], messageCount: 1 }, output, inputTokens: 4400, outputTokens: 200, costUsd: 0.0005, latencyMs: 1200, ...over });

export const baseRun = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: 'r1',
  question: 'Which 3 campaigns had the biggest ROAS drop last week?',
  status: 'running',
  provider: 'anthropic',
  model: 'claude-haiku-5-5',
  promptVersion: 'v1.0.0',
  error: null,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCostUsd: 0,
  totalLatencyMs: 0,
  retries: 0,
  repairs: 0,
  createdAt: '2026-10-31T10:00:00.000Z',
  completedAt: null,
  finalAnswer: null,
  steps: [],
  resumable: false,
  ...over,
});

export const view = (over: Partial<AgentRun> = {}): RunView => ({ ...baseRun(over), inFlight: [] });
