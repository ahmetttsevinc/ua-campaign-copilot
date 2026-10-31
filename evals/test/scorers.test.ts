import type { AgentRun, AgentStep, FinalAnswer, Finding } from '@copilot/shared';
import { describe, expect, it } from 'vitest';
import { CASES } from '../cases/index.js';
import type { Truth } from '../groundTruth.js';
import { scoreExpectations } from '../scorers/expectations.js';
import { matches, scoreNumeric } from '../scorers/numeric.js';
import { scoreToolUsage } from '../scorers/toolUsage.js';
import { EvalCase } from '../types.js';

const caseById = (id: string) => CASES.find((c) => c.id === id) as EvalCase;

const answer = (over: Partial<FinalAnswer> = {}): FinalAnswer => ({
  summary: 'cmp_007 ROAS fell because of click injection fraud; cmp_012 spend doubled.',
  findings: [
    { campaignId: 'cmp_007', campaignName: 'Tile Tide', metric: 'roas', before: 0.9318, after: 0.4738, changePct: -49.2, likelyCause: 'Click injection: 30% suspicious installs', evidence: ['step_2'] },
    { campaignId: 'cmp_012', campaignName: 'Cartly', metric: 'roas', before: 1.2733, after: 0.6784, changePct: -46.7, likelyCause: 'Spend doubled', evidence: ['step_2'] },
  ],
  caveats: [],
  confidence: 'high',
  ...over,
});

const [f0, f1] = answer().findings as [Finding, Finding];

const toolStep = (n: number, toolName: string, error?: string): AgentStep => ({
  id: `s${n}`, runId: 'r', stepNumber: n, type: 'tool_call', toolName, input: {}, isError: Boolean(error),
  output: error ? { ok: false, error: { code: error } } : { ok: true, output: {} },
  inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 1, createdAt: '',
});
const llmStep = (n: number): AgentStep => ({ ...toolStep(n, ''), type: 'llm_call', toolName: null });

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: 'r', question: 'q', status: 'completed', provider: 'fake', model: 'fake', promptVersion: 'v1.0.0', error: null,
  totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, totalLatencyMs: 0, retries: 0, repairs: 0,
  createdAt: '', completedAt: null, resumable: false, finalAnswer: answer(),
  steps: [llmStep(1), toolStep(2, 'compare_campaign_periods'), llmStep(3), toolStep(4, 'get_fraud_signals'), llmStep(5)],
  ...over,
});

describe('cases', () => {
  it('has at least 15 valid cases covering S1-S6 and adversarial ones', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(CASES.map((c) => c.scenario))).toEqual(new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'ADV']));
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) expect(EvalCase.safeParse(c).success).toBe(true);
  });
});

describe('scoreExpectations', () => {
  const c = caseById('s1-roas-drop-top3');

  it('passes a correct S1 answer', () => {
    expect(scoreExpectations(run(), c)).toEqual({ status: 'pass', details: [] });
  });

  it('fails when a required campaign, direction or cause is missing', () => {
    const r = scoreExpectations(run({ finalAnswer: answer({ summary: 'x', findings: [{ ...f0, changePct: 12, likelyCause: 'seasonality' }] }) }), c);
    expect(r.status).toBe('fail');
    expect(r.details).toEqual(expect.arrayContaining(['missing finding for cmp_012', 'cmp_007: expected direction down', expect.stringMatching(/cause keywords/)]));
  });

  it('fails when a healthy campaign is flagged, and allows paused campaigns explained as paused', () => {
    const extra = (campaignId: string, likelyCause: string) => ({ campaignId, campaignName: 'x', metric: 'roas', before: 1, after: 0.8, changePct: -20, likelyCause, evidence: [] });
    const flagged = scoreExpectations(run({ finalAnswer: answer({ findings: [...answer().findings, extra('cmp_005', 'decline')] }) }), c);
    expect(flagged.details).toContain('flagged cmp_005 (roas -20%) but it should not be');
    const paused = scoreExpectations(run({ finalAnswer: answer({ findings: [...answer().findings, extra('cmp_021', 'Campaign is paused')] }) }), c);
    expect(paused.status).toBe('pass');
  });

  it('fails runs that did not complete', () => {
    expect(scoreExpectations(run({ status: 'budget_exceeded', finalAnswer: null, error: 'Token budget exhausted' }), c)).toMatchObject({ status: 'fail' });
  });

  it('checks caveats and confidence for the outage case', () => {
    const outage = caseById('adv-attribution-down');
    expect(scoreExpectations(run({ finalAnswer: answer({ findings: [], caveats: [], confidence: 'high' }) }), outage).details).toEqual([
      expect.stringMatching(/caveats do not mention/),
      'confidence high exceeds medium',
    ]);
    expect(scoreExpectations(run({ finalAnswer: answer({ findings: [], caveats: ['Attribution data was unavailable'], confidence: 'low' }) }), outage).status).toBe('pass');
  });
});

describe('scoreNumeric', () => {
  const truth: Truth = {
    async values(campaignId, metric, w) {
      if (metric !== 'roas') return [];
      const last = w.to === '2026-11-01';
      if (campaignId === 'cmp_007') return [last ? 0.47381 : 0.93176];
      if (campaignId === 'cmp_012') return [last ? 0.6784 : 1.2733];
      return [];
    },
  };

  it('accepts values within ±2%, including rounded and percent forms', async () => {
    expect(matches(0.47, [0.47381])).toBe(true);
    expect(matches(47.4, [0.47381])).toBe(true);
    expect(matches(0.5, [0.47381])).toBe(false);
    expect((await scoreNumeric(run(), caseById('s1-roas-drop-top3'), truth)).status).toBe('pass');
  });

  it('fails invented numbers and skips metrics without ground truth', async () => {
    const bad = run({ finalAnswer: answer({ findings: [{ ...f0, after: 0.6 }, { ...f1, metric: 'vibes' }] }) });
    const r = await scoreNumeric(bad, caseById('s1-roas-drop-top3'), truth);
    expect(r.status).toBe('fail');
    expect(r.details).toEqual(['0/1 findings match', 'cmp_007 roas: before=0.9318 after=0.6 do not match ground truth (±2%)', 'unchecked: no ground truth for metric "vibes"']);
  });
});

describe('scoreToolUsage', () => {
  it('passes when required tools were used within the step limit', () => {
    expect(scoreToolUsage(run(), caseById('s1-roas-drop-top3')).status).toBe('pass');
  });

  it('fails on missing tools, too many steps and invented tools', () => {
    const steps = [...Array.from({ length: 9 }, (_, i) => llmStep(i + 1)), toolStep(20, 'dummy', 'unknown_tool'), toolStep(21, 'compare_campaign_periods', 'invalid_input')];
    const r = scoreToolUsage(run({ steps }), caseById('s1-roas-drop-top3'));
    expect(r.status).toBe('fail');
    expect(r.details).toEqual(
      expect.arrayContaining(['did not call get_fraud_signals', '9 LLM steps, limit for this question is 8', 'called nonexistent tool(s): dummy', '1 tool call(s) with invalid input (recovered)']),
    );
  });
});

describe('numeric scorer windows', () => {
  it('checks numbers against the windows the agent actually queried', async () => {
    const custom = { from: '2026-10-27', to: '2026-11-01' };
    const truth: Truth = { values: async (_c, _m, w) => (w.from === custom.from ? [-34.5] : [-30.6]) };
    const r = run({
      finalAnswer: answer({ findings: [{ campaignId: 'cmp_003', campaignName: 'x', metric: 'installDiscrepancyPct', before: null, after: -34.5, changePct: null, likelyCause: 'tracking', evidence: [] }] }),
      steps: [{ ...toolStep(2, 'get_attribution_data'), input: { toolCallId: 'a', input: { period: custom } } }],
    });
    expect((await scoreNumeric(r, caseById('s4-not-a-drop'), truth)).status).toBe('pass');
  });
});
