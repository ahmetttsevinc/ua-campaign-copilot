import type { AgentRun } from '@copilot/shared';
import { LAST_7, PREV_7 } from '../../apps/api/src/db/seed/scenarios.js';
import type { Truth } from '../groundTruth.js';
import type { EvalCase, Score } from '../types.js';

export const TOLERANCE = 0.02;

type Period = { from: string; to: string };
const isPeriod = (v: unknown): v is Period =>
  typeof v === 'object' && v !== null && typeof (v as Period).from === 'string' && typeof (v as Period).to === 'string';

/** Every {from, to} the agent passed to a tool (period, before, after, baselinePeriod). */
export function queriedPeriods(run: AgentRun): Period[] {
  const seen = new Map<string, Period>();
  for (const s of run.steps) {
    if (s.type !== 'tool_call') continue;
    const input = (s.input as { input?: Record<string, unknown> } | null)?.input ?? {};
    for (const v of Object.values(input)) if (isPeriod(v)) seen.set(`${v.from}/${v.to}`, { from: v.from, to: v.to });
  }
  return [...seen.values()];
}

/** Within ±2% relative (or a tiny absolute slack for values near zero), also accepting percent/ratio forms. */
export function matches(value: number, truths: number[]): boolean {
  return truths.some((t) =>
    [t, t * 100, t / 100].some((cand) => Math.abs(value - cand) <= Math.max(Math.abs(cand) * TOLERANCE, 0.005)),
  );
}

/**
 * Every before/after number in the findings must match ground truth computed straight from
 * the DB and vendor files. Metrics the truth table does not know are reported, not failed.
 */
export async function scoreNumeric(run: AgentRun, c: EvalCase, truth: Truth): Promise<Score> {
  const a = run.finalAnswer;
  if (!a) return { status: 'skip', details: ['no answer'] };
  // The case's reference windows plus every period the agent itself queried: a number is right if it
  // matches independent ground truth for the window the agent asked about (e.g. "last 5 days").
  const queried = queriedPeriods(run);
  const windows = [...(c.truthWindows ?? [{ before: PREV_7, after: LAST_7 }]), ...queried.flatMap((p) => queried.map((q) => ({ before: p, after: q })))];
  const details: string[] = [];
  let checked = 0;

  for (const f of a.findings) {
    if (f.before === null && f.after === null) continue;
    let known = false;
    let ok = false;
    for (const w of windows) {
      const [tb, ta] = await Promise.all([truth.values(f.campaignId, f.metric, w.before), truth.values(f.campaignId, f.metric, w.after)]);
      if (tb.length === 0 && ta.length === 0) continue;
      known = true;
      const beforeOk = f.before === null || matches(f.before, tb);
      const afterOk = f.after === null || matches(f.after, ta);
      if (beforeOk && afterOk) {
        ok = true;
        break;
      }
    }
    if (!known) {
      details.push(`unchecked: no ground truth for metric "${f.metric}"`);
      continue;
    }
    checked++;
    if (!ok) details.push(`${f.campaignId} ${f.metric}: before=${f.before} after=${f.after} do not match ground truth (±${TOLERANCE * 100}%)`);
  }

  if (checked === 0) return { status: 'skip', details: details.length ? details : ['no numeric findings to check'] };
  const failed = details.filter((d) => !d.startsWith('unchecked')).length;
  return { status: failed ? 'fail' : 'pass', details: [`${checked - failed}/${checked} findings match`, ...details] };
}
