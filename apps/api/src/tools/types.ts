import type { z } from 'zod';
import type { Db } from '../db/client.js';
import type { FraudStore } from '../sources/fraudCsv/loader.js';

export interface ToolContext {
  db: Db;
  fraud: FraudStore;
  attributionBaseUrl: string;
  /** Aborted when the tool exceeds its timeout, so in-flight HTTP calls stop too. */
  signal: AbortSignal;
  /**
   * Epoch ms shortly before the hard timeout. Tools that fan out (attribution) stop waiting
   * here and return partial results plus gaps, instead of being killed and losing everything.
   */
  deadlineAt: number;
}

/** What callers provide; runTool adds the per-call signal and deadline. */
export type ToolEnv = Omit<ToolContext, 'signal' | 'deadlineAt'>;

export interface Tool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string;
  /** Written for the model: what it does, when to use it and when not to. */
  description: string;
  input: I;
  output: O;
  execute(input: z.output<I>, ctx: ToolContext): Promise<z.input<O>>;
}

/** Identity helper that keeps input/output types linked when declaring a tool. */
export function defineTool<I extends z.ZodType, O extends z.ZodType>(tool: Tool<I, O>): Tool<I, O> {
  return tool;
}

export type ToolErrorCode = 'unknown_tool' | 'invalid_input' | 'timeout' | 'execution_error' | 'invalid_output';

export type ToolResult =
  | { ok: true; output: unknown; durationMs: number }
  | { ok: false; error: { code: ToolErrorCode; message: string; details?: unknown }; durationMs: number };
