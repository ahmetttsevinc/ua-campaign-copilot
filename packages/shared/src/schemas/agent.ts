import { z } from 'zod';
import { FinalAnswer } from './answer.js';

export const RunStatus = z.enum([
  'running',
  'completed',
  'failed',
  'failed_validation',
  'budget_exceeded',
  'max_steps_exceeded',
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const StepType = z.enum(['llm_call', 'tool_call', 'repair']);
export type StepType = z.infer<typeof StepType>;

export const ProviderName = z.enum(['anthropic', 'nebius', 'fake']);
export type ProviderName = z.infer<typeof ProviderName>;

export const AgentStep = z.object({
  id: z.string(),
  runId: z.string(),
  stepNumber: z.number().int(),
  type: StepType,
  toolName: z.string().nullable(),
  input: z.unknown(),
  output: z.unknown(),
  isError: z.boolean(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  latencyMs: z.number().int(),
  createdAt: z.string(),
});
export type AgentStep = z.infer<typeof AgentStep>;

export const AgentRunSummary = z.object({
  id: z.string(),
  question: z.string(),
  status: RunStatus,
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  error: z.string().nullable(),
  totalInputTokens: z.number().int(),
  totalOutputTokens: z.number().int(),
  totalCostUsd: z.number(),
  totalLatencyMs: z.number().int(),
  retries: z.number().int(),
  repairs: z.number().int(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type AgentRunSummary = z.infer<typeof AgentRunSummary>;

export const AgentRun = AgentRunSummary.extend({
  finalAnswer: FinalAnswer.nullable(),
  steps: z.array(AgentStep),
  /** True when POST /runs/:id/resume would pick this run up. */
  resumable: z.boolean(),
});
export type AgentRun = z.infer<typeof AgentRun>;

export const AgentEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run_started'), runId: z.string(), run: AgentRunSummary }),
  z.object({
    type: z.literal('step_started'),
    runId: z.string(),
    stepNumber: z.number().int(),
    stepType: StepType,
    toolName: z.string().nullable(),
  }),
  z.object({ type: z.literal('step_completed'), runId: z.string(), step: AgentStep, run: AgentRunSummary }),
  z.object({ type: z.literal('run_completed'), runId: z.string(), run: AgentRun }),
  z.object({ type: z.literal('run_failed'), runId: z.string(), run: AgentRun }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

export const CreateRunBody = z
  .object({
    question: z.string().trim().min(3).max(2000),
    provider: z.enum(['anthropic', 'nebius', 'fake']).optional(),
  })
  .strict();
export type CreateRunBody = z.infer<typeof CreateRunBody>;

export const CreateRunResponse = z.object({ runId: z.string() });

export const ListRunsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).strict();

export const ListRunsResponse = z.object({ runs: z.array(AgentRunSummary) });
