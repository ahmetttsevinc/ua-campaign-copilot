import type { Score, ScorerName } from './types.js';

export interface CaseResult {
  caseId: string;
  scenario: string;
  question: string;
  provider: string;
  model: string;
  promptVersion: string;
  runId: string;
  status: string;
  passed: boolean;
  scores: Partial<Record<ScorerName, Score>>;
  judgeScore?: number;
  llmSteps: number;
  totalSteps: number;
  tokens: number;
  costUsd: number;
  latencyMs: number;
  error?: string;
}

const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${Math.round((n / d) * 100)}%`);
const usd = (n: number) => `$${n.toFixed(4)}`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const percentile = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
};
const mark = (s: Score | undefined) => (!s ? '' : s.status === 'pass' ? 'pass' : s.status === 'fail' ? 'FAIL' : 'skip');

export interface ProviderSummary {
  provider: string;
  model: string;
  cases: number;
  passed: number;
  passRate: string;
  scorerPassRates: Record<ScorerName, string>;
  totalCostUsd: number;
  medianCostUsd: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgLlmSteps: number;
  avgJudgeScore: number | null;
}

export function summarize(results: CaseResult[]): ProviderSummary[] {
  const byProvider = new Map<string, CaseResult[]>();
  for (const r of results) byProvider.set(r.provider, [...(byProvider.get(r.provider) ?? []), r]);
  return [...byProvider.entries()].map(([provider, rs]) => {
    const rate = (name: ScorerName) => {
      const scored = rs.filter((r) => r.scores[name] && r.scores[name]?.status !== 'skip');
      return pct(scored.filter((r) => r.scores[name]?.status === 'pass').length, scored.length);
    };
    const judged = rs.filter((r) => r.judgeScore !== undefined);
    return {
      provider,
      model: rs[0]?.model ?? '',
      cases: rs.length,
      passed: rs.filter((r) => r.passed).length,
      passRate: pct(rs.filter((r) => r.passed).length, rs.length),
      scorerPassRates: { expectations: rate('expectations'), numeric: rate('numeric'), toolUsage: rate('toolUsage'), judge: rate('judge') },
      totalCostUsd: rs.reduce((s, r) => s + r.costUsd, 0),
      medianCostUsd: percentile(rs.map((r) => r.costUsd), 50),
      p50LatencyMs: percentile(rs.map((r) => r.latencyMs), 50),
      p95LatencyMs: percentile(rs.map((r) => r.latencyMs), 95),
      avgLlmSteps: Math.round((rs.reduce((s, r) => s + r.llmSteps, 0) / rs.length) * 10) / 10,
      avgJudgeScore: judged.length ? Math.round((judged.reduce((s, r) => s + (r.judgeScore ?? 0), 0) / judged.length) * 10) / 10 : null,
    };
  });
}

export function printConsole(results: CaseResult[], summaries: ProviderSummary[]): void {
  console.table(
    results.map((r) => ({
      case: r.caseId,
      provider: r.provider,
      pass: r.passed ? 'PASS' : 'FAIL',
      expect: mark(r.scores.expectations),
      numeric: mark(r.scores.numeric),
      tools: mark(r.scores.toolUsage),
      judge: mark(r.scores.judge),
      steps: r.llmSteps,
      tokens: r.tokens,
      cost: usd(r.costUsd),
      latency: sec(r.latencyMs),
    })),
  );
  console.table(
    summaries.map((s) => ({
      provider: s.provider,
      model: s.model,
      'pass rate': `${s.passRate} (${s.passed}/${s.cases})`,
      'total cost': usd(s.totalCostUsd),
      'p50 latency': sec(s.p50LatencyMs),
      'p95 latency': sec(s.p95LatencyMs),
      'avg steps': s.avgLlmSteps,
    })),
  );
}

export function toMarkdown(results: CaseResult[], summaries: ProviderSummary[], meta: { startedAt: string; promptVersion: string; judge: boolean; command: string }): string {
  const lines: string[] = [];
  lines.push(`# Eval report, ${meta.startedAt}`, '');
  lines.push(`Prompt version \`${meta.promptVersion}\`, ${new Set(results.map((r) => r.caseId)).size} cases, judge ${meta.judge ? 'on' : 'off'}. Command: \`${meta.command}\``, '');
  lines.push('A case passes when every scorer that applies to it passes. Scorers: **expectations** (right campaigns, direction, cause, caveats, nothing invented), **numeric** (every before/after within ±2% of ground truth computed directly from the DB and vendor files), **tool usage** (required sources used, step limit, no invented tools), **judge** (optional LLM grade of the cause explanation, 1 to 5).', '');
  lines.push('## Summary', '');
  lines.push('| Provider | Model | Pass rate | Expectations | Numeric | Tool usage | Judge | Total cost | Median cost/run | p50 latency | p95 latency | Avg LLM steps |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of summaries) {
    lines.push(
      `| ${s.provider} | \`${s.model}\` | **${s.passRate}** (${s.passed}/${s.cases}) | ${s.scorerPassRates.expectations} | ${s.scorerPassRates.numeric} | ${s.scorerPassRates.toolUsage} | ${s.avgJudgeScore ?? 'n/a'} | ${usd(s.totalCostUsd)} | ${usd(s.medianCostUsd)} | ${sec(s.p50LatencyMs)} | ${sec(s.p95LatencyMs)} | ${s.avgLlmSteps} |`,
    );
  }
  lines.push('', '## Cases', '');
  lines.push('| Case | Scenario | Provider | Result | Expectations | Numeric | Tools | Judge | LLM steps | Tokens | Cost | Latency |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of [...results].sort((a, b) => a.caseId.localeCompare(b.caseId) || a.provider.localeCompare(b.provider))) {
    lines.push(
      `| ${r.caseId} | ${r.scenario} | ${r.provider} | ${r.passed ? 'pass' : '**FAIL**'} | ${mark(r.scores.expectations)} | ${mark(r.scores.numeric)} | ${mark(r.scores.toolUsage)} | ${r.judgeScore ?? mark(r.scores.judge)} | ${r.llmSteps} | ${r.tokens} | ${usd(r.costUsd)} | ${sec(r.latencyMs)} |`,
    );
  }
  const failures = results.filter((r) => !r.passed);
  lines.push('', '## Failures', '');
  if (failures.length === 0) lines.push('None.');
  for (const r of failures) {
    lines.push(`### ${r.caseId} (${r.provider})`, '', `> ${r.question}`, '', `Run \`${r.runId}\`, status \`${r.status}\`.`, '');
    for (const [name, s] of Object.entries(r.scores)) {
      if (s?.status === 'fail') for (const d of s.details) lines.push(`- **${name}:** ${d}`);
    }
    if (r.error) lines.push(`- **error:** ${r.error}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
