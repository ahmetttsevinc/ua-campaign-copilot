import type { FinalAnswer } from '@copilot/shared';
import type { StepRow } from './persistence.js';
import { ToolStepOutput } from './state.js';

/**
 * Data-gap guardrail. The prompt asks the model to report missing data, but a UA manager must
 * never get a confident answer built on a partial picture because the model forgot. So the loop
 * checks itself: any failed tool call or attribution `dataGaps` entry must surface as a caveat,
 * and the answer cannot claim high confidence.
 */

export function collectDataGaps(toolSteps: StepRow[]): string[] {
  const gaps: string[] = [];
  for (const s of toolSteps) {
    const out = ToolStepOutput.safeParse(s.output);
    if (!out.success) continue;
    if (!out.data.ok) {
      const err = out.data.error as { code?: string; message?: string } | undefined;
      // Invalid input is the model's own mistake, which it can retry; it is not missing data.
      if (err?.code !== 'invalid_input' && err?.code !== 'unknown_tool') gaps.push(`${s.toolName ?? 'tool'} failed: ${err?.message ?? 'unknown error'}`);
      continue;
    }
    const reported = (out.data.output as { dataGaps?: unknown } | undefined)?.dataGaps;
    if (Array.isArray(reported)) gaps.push(...reported.filter((g): g is string => typeof g === 'string'));
  }
  return [...new Set(gaps)];
}

const MENTIONS_GAP = /unavailable|data gap|could not|couldn't|missing|failed|not available|incomplete|outage/i;

export function applyDataGapCheck(answer: FinalAnswer, toolSteps: StepRow[]): { answer: FinalAnswer; gaps: string[]; added: boolean } {
  const gaps = collectDataGaps(toolSteps);
  if (gaps.length === 0) return { answer, gaps, added: false };
  const alreadyReported = answer.caveats.some((c) => MENTIONS_GAP.test(c));
  return {
    answer: {
      ...answer,
      confidence: answer.confidence === 'high' ? 'medium' : answer.confidence,
      caveats: alreadyReported ? answer.caveats : [...answer.caveats, `Some data could not be fetched, so this answer may be incomplete: ${gaps.join('; ')}`],
    },
    gaps,
    added: !alreadyReported,
  };
}
