import type { AgentRun, Finding } from '@copilot/shared';
import type { EvalCase, Score } from '../types.js';

/** Content checks: the right campaigns, direction, cause, caveats; nothing invented. */
export function scoreExpectations(run: AgentRun, c: EvalCase): Score {
  const details: string[] = [];
  const a = run.finalAnswer;
  if (run.status !== 'completed' || !a) return { status: 'fail', details: [`run ended as ${run.status}${run.error ? `: ${run.error.slice(0, 160)}` : ''}`] };

  const findingText = (f: Finding) => `${f.campaignId} ${f.campaignName} ${f.metric} ${f.likelyCause}`;
  const all = [a.summary, ...a.caveats, ...a.findings.map(findingText)].join('\n').toLowerCase();
  const caveats = a.caveats.join('\n').toLowerCase();
  const e = c.expected;

  for (const want of e.findCampaigns) {
    const candidates = a.findings.filter((f) => f.campaignId === want.campaignId);
    if (candidates.length === 0) {
      details.push(`missing finding for ${want.campaignId}`);
      continue;
    }
    const metricOk = want.metricAnyOf
      ? candidates.filter((f) => want.metricAnyOf?.some((m) => f.metric.toLowerCase().replace(/[^a-z0-9]/g, '').includes(m.toLowerCase().replace(/[^a-z0-9]/g, ''))))
      : candidates;
    if (metricOk.length === 0) {
      details.push(`${want.campaignId}: expected metric ${want.metricAnyOf?.join('/')}, got ${candidates.map((f) => f.metric).join(', ')}`);
      continue;
    }
    if (want.direction) {
      const sign = (f: Finding) => f.changePct ?? (f.before !== null && f.after !== null ? f.after - f.before : null);
      const right = metricOk.some((f) => {
        const s = sign(f);
        return s !== null && (want.direction === 'down' ? s < 0 : s > 0);
      });
      if (!right) details.push(`${want.campaignId}: expected direction ${want.direction}`);
    }
  }

  if (e.causeKeywords.length && !e.causeKeywords.some((k) => all.includes(k.toLowerCase()))) {
    details.push(`none of the expected cause keywords found: ${e.causeKeywords.join(', ')}`);
  }

  for (const nf of e.mustNotFlag) {
    for (const f of a.findings.filter((x) => x.campaignId === nf.campaignId)) {
      if (!nf.unlessMentions || !findingText(f).toLowerCase().includes(nf.unlessMentions.toLowerCase())) {
        details.push(`flagged ${nf.campaignId} (${f.metric} ${f.changePct ?? ''}%) but it should not be`);
      }
    }
  }

  for (const id of e.quietCampaigns) {
    for (const f of a.findings.filter((x) => x.campaignId === id)) {
      if (f.changePct !== null && Math.abs(f.changePct) >= 10) details.push(`${id} is healthy but was reported with a ${f.changePct}% change`);
    }
  }

  if (e.caveatMentions.length && !e.caveatMentions.some((k) => caveats.includes(k.toLowerCase()))) {
    details.push(`caveats do not mention any of: ${e.caveatMentions.join(', ')}`);
  }
  if (e.emptyFindings && a.findings.length > 0) details.push(`expected no findings, got ${a.findings.length}`);

  const rank = { low: 0, medium: 1, high: 2 } as const;
  if (e.maxConfidence && rank[a.confidence] > rank[e.maxConfidence]) details.push(`confidence ${a.confidence} exceeds ${e.maxConfidence}`);

  return { status: details.length ? 'fail' : 'pass', details };
}
