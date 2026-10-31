import { addDays } from '../../lib/dates.js';

/**
 * Ground truth for the seeded dataset. The seed reads the injection parameters from here
 * and the eval runner imports the same objects, so the anomalies and the expectations
 * can never drift apart.
 */

export const SEED = 20261101;

// A fixed "today" keeps every relative question ("last week") stable no matter when the
// seed or the demo runs. The agent is told this date in its system prompt.
export const DATA_END_DATE = '2026-11-01'; // a Sunday, so "last week" is a clean Mon–Sun
export const DATA_DAYS = 60;
export const DATA_START_DATE = addDays(DATA_END_DATE, -(DATA_DAYS - 1));

export const LAST_7 = { from: addDays(DATA_END_DATE, -6), to: DATA_END_DATE } as const;
export const PREV_7 = { from: addDays(DATA_END_DATE, -13), to: addDays(DATA_END_DATE, -7) } as const;

export type ScenarioId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';
export type Direction = 'down' | 'up' | 'none';

export interface Scenario {
  id: ScenarioId;
  title: string;
  campaignIds: string[];
  window: { from: string; to: string };
  /** Metric the agent should talk about, from the UA manager's point of view. */
  metric: string | null;
  direction: Direction;
  expectedFinding: string;
  /** Any one of these appearing in the cause text counts as naming the right cause. */
  causeKeywords: string[];
  /** Sources the agent needs to touch to reach the expected finding. */
  requiredTools: string[];
}

/** Multipliers applied by the seed. Kept next to the scenarios so the docs are the code. */
export const INJECTIONS = {
  S1: {
    campaignId: 'cmp_007',
    window: LAST_7,
    revenueMultiplier: 0.52,
    installsMultiplier: 1.03,
    clicksMultiplier: 1.05,
    suspiciousInstallRate: { min: 0.28, max: 0.33 },
    medianCtitSeconds: { min: 4, max: 7.5 },
    flaggedSubPublishers: ['sp_4471', 'sp_9020'],
  },
  S2: {
    campaignId: 'cmp_012',
    window: LAST_7,
    spendMultiplier: 2.0,
    installsMultiplier: 1.1,
    revenueMultiplier: 1.1,
    clicksMultiplier: 1.12,
  },
  S3: {
    campaignId: 'cmp_018',
    window: LAST_7,
    d7RetentionMultiplier: 0.5,
  },
  S4: {
    campaignId: 'cmp_003',
    window: { from: addDays(DATA_END_DATE, -4), to: DATA_END_DATE },
    attributionInstallsMultiplier: 0.6,
  },
  S5: {
    campaignId: 'cmp_021',
    // Paused 10 days ago: no activity on the last 10 days of data.
    pausedFrom: addDays(DATA_END_DATE, -9),
  },
} as const;

export const HEALTHY_CONTROL_IDS = ['cmp_001', 'cmp_005', 'cmp_010', 'cmp_015', 'cmp_020', 'cmp_024'];

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'S1',
    title: 'Fraud-driven ROAS drop',
    campaignIds: [INJECTIONS.S1.campaignId],
    window: LAST_7,
    metric: 'roas',
    direction: 'down',
    expectedFinding:
      'ROAS dropped ~48% last week with stable installs and lower revenue; fraud vendor shows ~30% suspicious installs and median CTIT under 8 s, i.e. click injection.',
    causeKeywords: ['fraud', 'click injection', 'ctit', 'suspicious'],
    requiredTools: ['compare_campaign_periods', 'get_fraud_signals'],
  },
  {
    id: 'S2',
    title: 'Spend doubled without scale',
    campaignIds: [INJECTIONS.S2.campaignId],
    window: LAST_7,
    metric: 'cpi',
    direction: 'up',
    expectedFinding:
      'Spend roughly doubled while installs rose only ~10%, so CPI went up ~80% and ROAS fell; likely a bid increase that did not buy extra scale.',
    causeKeywords: ['bid', 'spend', 'scale', 'cpi'],
    requiredTools: ['compare_campaign_periods'],
  },
  {
    id: 'S3',
    title: 'Low quality users',
    campaignIds: [INJECTIONS.S3.campaignId],
    window: LAST_7,
    metric: 'd7_retention',
    direction: 'down',
    expectedFinding:
      'Install volume is normal but D7 retention in attribution data halved; users are low quality and revenue will lag.',
    causeKeywords: ['retention', 'quality', 'd7'],
    requiredTools: ['resolve_campaign_id', 'get_attribution_data'],
  },
  {
    id: 'S4',
    title: 'Attribution discrepancy',
    campaignIds: [INJECTIONS.S4.campaignId],
    window: INJECTIONS.S4.window,
    metric: 'installs',
    direction: 'none',
    expectedFinding:
      'Attribution provider reports ~40% fewer installs than internal data over the last 5 days; this is a tracking/attribution discrepancy, not a performance change.',
    causeKeywords: ['discrepancy', 'tracking', 'attribution', 'mismatch'],
    requiredTools: ['resolve_campaign_id', 'get_attribution_data'],
  },
  {
    id: 'S5',
    title: 'Paused campaign',
    campaignIds: [INJECTIONS.S5.campaignId],
    window: { from: INJECTIONS.S5.pausedFrom, to: DATA_END_DATE },
    metric: null,
    direction: 'none',
    expectedFinding: 'Campaign was paused 10 days ago; zero activity is expected and is not a performance drop.',
    causeKeywords: ['paused'],
    requiredTools: ['list_campaigns'],
  },
  {
    id: 'S6',
    title: 'Healthy controls',
    campaignIds: HEALTHY_CONTROL_IDS,
    window: LAST_7,
    metric: null,
    direction: 'none',
    expectedFinding: 'No material change; the agent must not invent problems for these campaigns.',
    causeKeywords: [],
    requiredTools: [],
  },
];
