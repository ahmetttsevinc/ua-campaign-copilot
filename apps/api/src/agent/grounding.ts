import type { FinalAnswer } from '@copilot/shared';

/**
 * Cheap hallucination guardrail: every before/after number in the answer must match a number
 * some tool actually returned in this run (exactly, or as a rounding of it, or as the same
 * ratio expressed in percent). The LLM is told to copy numbers, so a miss means it invented
 * or computed one.
 */

export function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectNumbers(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectNumbers(v, out);
  return out;
}

function decimals(n: number): number {
  const s = String(n);
  if (s.includes('e')) return 10;
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

const roundTo = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export function isGrounded(value: number, pool: number[]): boolean {
  const d = decimals(value);
  for (const source of pool) {
    for (const candidate of [source, source * 100]) {
      if (Math.abs(candidate - value) < 1e-9) return true;
      // Rounding a large number to an integer (spend 13360.63 -> 13361) is fine; rounding a ratio
      // to an integer (0.93 -> 1) would match almost anything, so it is not accepted.
      if (d === 0 && Math.abs(candidate) < 10) continue;
      if (d < decimals(candidate) && Math.abs(roundTo(candidate, d) - value) < 1e-9) return true;
    }
  }
  return false;
}

export interface GroundingResult {
  answer: FinalAnswer;
  ungrounded: { campaignId: string; field: 'before' | 'after'; value: number }[];
}

export function applyGroundingCheck(answer: FinalAnswer, toolOutputs: unknown[]): GroundingResult {
  const pool = collectNumbers(toolOutputs);
  const ungrounded: GroundingResult['ungrounded'] = [];
  for (const f of answer.findings) {
    for (const field of ['before', 'after'] as const) {
      const v = f[field];
      if (v !== null && !isGrounded(v, pool)) ungrounded.push({ campaignId: f.campaignId, field, value: v });
    }
  }
  if (ungrounded.length === 0) return { answer, ungrounded };
  const list = ungrounded.map((u) => `${u.campaignId} ${u.field}=${u.value}`).join(', ');
  return {
    answer: {
      ...answer,
      confidence: 'low',
      caveats: [...answer.caveats, `Some numbers could not be traced to any tool output and may be wrong: ${list}.`],
    },
    ungrounded,
  };
}
