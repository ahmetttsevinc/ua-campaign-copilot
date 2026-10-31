import { compareCampaignPeriods } from './compareCampaignPeriods.js';
import { getAttributionData } from './getAttributionData.js';
import { getCampaignMetrics } from './getCampaignMetrics.js';
import { getFraudSignals } from './getFraudSignals.js';
import { listCampaigns } from './listCampaigns.js';
import { resolveCampaignId } from './resolveCampaignId.js';
import type { Tool, ToolEnv, ToolResult } from './types.js';

export const TOOLS: readonly Tool[] = [
  listCampaigns,
  getCampaignMetrics,
  compareCampaignPeriods,
  resolveCampaignId,
  getAttributionData,
  getFraudSignals,
] as Tool[];

export function getTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}

export class ToolTimeoutError extends Error {}

/**
 * The single entry point the agent loop uses to run a tool. Never throws: every failure
 * becomes a structured error the model can read and react to, which is what lets a run
 * survive a bad tool call instead of crashing.
 */
export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolEnv,
  timeoutMs: number,
): Promise<ToolResult> {
  const started = performance.now();
  // Leave time to assemble and validate a partial result before the hard timeout fires.
  const deadlineAt = Date.now() + timeoutMs - Math.min(500, Math.round(timeoutMs * 0.1));
  const elapsed = () => Math.round(performance.now() - started);

  const tool = getTool(name);
  if (!tool) {
    return {
      ok: false,
      error: { code: 'unknown_tool', message: `No tool named "${name}". Available: ${TOOLS.map((t) => t.name).join(', ')}` },
      durationMs: elapsed(),
    };
  }

  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: 'Tool input failed validation; fix the listed fields and call again.',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      durationMs: elapsed(),
    };
  }

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ToolTimeoutError(`Tool timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });

  let output: unknown;
  try {
    output = await Promise.race([tool.execute(parsed.data, { ...ctx, signal: controller.signal, deadlineAt }), timeout]);
  } catch (err) {
    const isTimeout = err instanceof ToolTimeoutError;
    return {
      ok: false,
      error: { code: isTimeout ? 'timeout' : 'execution_error', message: err instanceof Error ? err.message : String(err) },
      durationMs: elapsed(),
    };
  } finally {
    clearTimeout(timer);
  }

  // A tool returning the wrong shape is our bug, but the model should still get a clean error.
  const checked = tool.output.safeParse(output);
  if (!checked.success) {
    return {
      ok: false,
      error: { code: 'invalid_output', message: `Tool ${name} produced invalid output`, details: checked.error.issues },
      durationMs: elapsed(),
    };
  }
  return { ok: true, output: checked.data, durationMs: elapsed() };
}
