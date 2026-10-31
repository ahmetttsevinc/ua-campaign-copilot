import type {
  CompareCampaignPeriodsOutput,
  GetAttributionDataOutput,
  GetCampaignMetricsOutput,
  GetFraudSignalsOutput,
  ListCampaignsOutput,
  ResolveCampaignIdOutput,
} from '@copilot/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateDataset } from '../src/db/seed/generate.js';
import { HEALTHY_CONTROL_IDS, INJECTIONS, LAST_7, PREV_7 } from '../src/db/seed/scenarios.js';
import { runTool, TOOLS } from '../src/tools/index.js';
import { startHarness, type Harness } from './toolHarness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

/** Runs a tool through the same path the agent uses and fails loudly on a tool error. */
async function call<T>(name: string, input: unknown): Promise<T> {
  const r = await runTool(name, input, h.ctx, 5000);
  if (!r.ok) throw new Error(`${name} failed: ${JSON.stringify(r.error)}`);
  return r.output as T;
}

// Independent ground truth from the pure generator, not from the SQL under test.
const data = generateDataset();
function truth(campaignId: string, w: { from: string; to: string }) {
  const rows = data.metrics.filter((m) => m.campaignId === campaignId && m.date >= w.from && m.date <= w.to);
  const spend = rows.reduce((s, r) => s + r.spendUsd, 0);
  const installs = rows.reduce((s, r) => s + r.installs, 0);
  const revenue = rows.reduce((s, r) => s + r.revenueUsd, 0);
  return { spend, installs, revenue, cpi: spend / installs, roas: revenue / spend };
}
const attrIdOf = (cmp: string) => data.mappings.find((m) => m.internalCampaignId === cmp)?.attributionCampaignId as string;

describe('tool registry', () => {
  it('has the six PRD tools, each with a description and schemas', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      'compare_campaign_periods',
      'get_attribution_data',
      'get_campaign_metrics',
      'get_fraud_signals',
      'list_campaigns',
      'resolve_campaign_id',
    ]);
    for (const t of TOOLS) expect(t.description.length).toBeGreaterThan(80);
  });
});

describe('list_campaigns', () => {
  it('lists all 24 and shows cmp_021 as paused with its last active date (S5)', async () => {
    const out = await call<ListCampaignsOutput>('list_campaigns', {});
    expect(out.total).toBe(24);
    expect(out.truncated).toBe(false);
    const c21 = out.campaigns.find((c) => c.id === 'cmp_021');
    expect(c21).toMatchObject({ status: 'paused', lastActiveDate: '2026-10-22' });
    expect(out.campaigns.find((c) => c.id === 'cmp_007')?.lastActiveDate).toBe('2026-11-01');
  });

  it('filters by vertical and platform', async () => {
    const out = await call<ListCampaignsOutput>('list_campaigns', { vertical: 'streaming', platform: 'android' });
    expect(out.campaigns.map((c) => c.id)).toEqual(['cmp_019', 'cmp_020']);
  });
});

describe('resolve_campaign_id', () => {
  it('resolves both directions and reports unknown ids instead of guessing', async () => {
    const af7 = attrIdOf('cmp_007');
    const out = await call<ResolveCampaignIdOutput>('resolve_campaign_id', { ids: ['cmp_007', af7, 'cmp_999', 'af_zzzz'] });
    expect(out.resolved).toEqual([
      { input: 'cmp_007', internalCampaignId: 'cmp_007', attributionCampaignId: af7, campaignName: 'Tile Tide | US | Android' },
      { input: af7, internalCampaignId: 'cmp_007', attributionCampaignId: af7, campaignName: 'Tile Tide | US | Android' },
    ]);
    expect(out.unresolved).toEqual(['cmp_999', 'af_zzzz']);
  });
});

describe('get_campaign_metrics', () => {
  it('aggregates totals in SQL matching the generated ground truth', async () => {
    const out = await call<GetCampaignMetricsOutput>('get_campaign_metrics', { campaignIds: ['cmp_007'], period: LAST_7 });
    const row = out.rows[0];
    const t = truth('cmp_007', LAST_7);
    expect(row?.installs).toBe(t.installs);
    expect(row?.spendUsd).toBeCloseTo(t.spend, 1);
    expect(row?.roas).toBeCloseTo(t.roas, 3);
    expect(row?.cpi).toBeCloseTo(t.cpi, 2);
    expect(row?.activeDays).toBe(7);
  });

  it('returns daily rows and lists unknown ids', async () => {
    const out = await call<GetCampaignMetricsOutput>('get_campaign_metrics', {
      campaignIds: ['cmp_012', 'cmp_404'],
      period: LAST_7,
      granularity: 'daily',
    });
    expect(out.rows).toHaveLength(7);
    expect(out.rows.map((r) => r.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(out.unknownCampaignIds).toEqual(['cmp_404']);
  });

  it('shows a paused campaign as zero activity, not missing (S5)', async () => {
    const out = await call<GetCampaignMetricsOutput>('get_campaign_metrics', { campaignIds: ['cmp_021'], period: LAST_7 });
    expect(out.rows[0]).toMatchObject({ status: 'paused', spendUsd: 0, installs: 0, roas: null, cpi: null, activeDays: 0 });
  });

  it('caps output at 50 rows and says so', async () => {
    const out = await call<GetCampaignMetricsOutput>('get_campaign_metrics', {
      campaignIds: ['cmp_001', 'cmp_002'],
      period: { from: '2026-09-03', to: '2026-11-01' },
      granularity: 'daily',
    });
    expect(out.rows).toHaveLength(50);
    expect(out.truncated).toBe(true);
    expect(out.note).toMatch(/50 of 120/);
  });
});

describe('compare_campaign_periods', () => {
  it('ranks cmp_007 as the biggest ROAS drop, then cmp_012 (M2 acceptance)', async () => {
    const out = await call<CompareCampaignPeriodsOutput>('compare_campaign_periods', { before: PREV_7, after: LAST_7, limit: 3 });
    expect(out.rows.map((r) => r.campaignId).slice(0, 2)).toEqual(['cmp_007', 'cmp_012']);
    const top = out.rows[0];
    const b = truth('cmp_007', PREV_7);
    const a = truth('cmp_007', LAST_7);
    expect(top?.changePct.roas).toBeCloseTo((a.roas / b.roas - 1) * 100, 0);
    expect(top?.changePct.roas).toBeLessThan(-40);
    expect(Math.abs(top?.changePct.installs ?? 99)).toBeLessThan(8);
    expect(out.totalCompared).toBe(24);
    expect(out.truncated).toBe(true);
  });

  it('S2: cmp_012 has the largest CPI increase, with spend ~2x and installs ~+10%', async () => {
    const out = await call<CompareCampaignPeriodsOutput>('compare_campaign_periods', {
      before: PREV_7,
      after: LAST_7,
      sortBy: 'cpi',
      order: 'largest_increase_first',
      limit: 1,
    });
    const r = out.rows[0];
    expect(r?.campaignId).toBe('cmp_012');
    expect(r?.changePct.spendUsd).toBeGreaterThan(80);
    expect(r?.changePct.installs).toBeGreaterThan(3);
    expect(r?.changePct.installs).toBeLessThan(18);
    expect(r?.changePct.cpi).toBeGreaterThan(60);
  });

  it('ranks the paused campaign last since its change is undefined (S5)', async () => {
    const out = await call<CompareCampaignPeriodsOutput>('compare_campaign_periods', { before: PREV_7, after: LAST_7, limit: 50 });
    const last = out.rows.at(-1);
    expect(last).toMatchObject({ campaignId: 'cmp_021', status: 'paused' });
    expect(last?.changePct.roas).toBeNull();
    expect(last?.after.activeDays).toBe(0);
  });

  it('S6: healthy controls move less than 10% on ROAS', async () => {
    const out = await call<CompareCampaignPeriodsOutput>('compare_campaign_periods', {
      campaignIds: HEALTHY_CONTROL_IDS,
      before: PREV_7,
      after: LAST_7,
    });
    expect(out.rows).toHaveLength(HEALTHY_CONTROL_IDS.length);
    for (const r of out.rows) expect(Math.abs(r.changePct.roas ?? 100)).toBeLessThan(10);
  });

  it('reports unknown campaign ids', async () => {
    const out = await call<CompareCampaignPeriodsOutput>('compare_campaign_periods', {
      campaignIds: ['cmp_999'],
      before: PREV_7,
      after: LAST_7,
    });
    expect(out.rows).toEqual([]);
    expect(out.unknownCampaignIds).toEqual(['cmp_999']);
  });
});

describe('get_attribution_data', () => {
  it('S3: cmp_018 D7 retention roughly halves versus the baseline week', async () => {
    const out = await call<GetAttributionDataOutput>('get_attribution_data', {
      attributionCampaignIds: [attrIdOf('cmp_018')],
      period: LAST_7,
      baselinePeriod: PREV_7,
    });
    const r = out.results[0];
    if (r?.status !== 'ok') throw new Error('expected ok');
    expect(r.internalCampaignId).toBe('cmp_018');
    expect(r.changePct?.d7Retention).toBeLessThan(-40);
    expect(r.changePct?.d7Retention).toBeGreaterThan(-60);
    expect(Math.abs(r.changePct?.installs ?? 99)).toBeLessThan(10);
    expect(out.dataGaps).toEqual([]);
  });

  it('S4: cmp_003 attribution installs are ~40% below internal over the last 5 days', async () => {
    const out = await call<GetAttributionDataOutput>('get_attribution_data', {
      attributionCampaignIds: [attrIdOf('cmp_003')],
      period: INJECTIONS.S4.window,
    });
    const r = out.results[0];
    if (r?.status !== 'ok') throw new Error('expected ok');
    expect(r.installDiscrepancyPct).toBeCloseTo(-40, 0);
    expect(r.internalInstalls).toBe(truth('cmp_003', INJECTIONS.S4.window).installs);
  });

  it('healthy campaigns show the normal 2-8% under-count', async () => {
    const out = await call<GetAttributionDataOutput>('get_attribution_data', {
      attributionCampaignIds: HEALTHY_CONTROL_IDS.map(attrIdOf),
      period: LAST_7,
    });
    expect(out.results).toHaveLength(HEALTHY_CONTROL_IDS.length);
    for (const r of out.results) {
      if (r.status !== 'ok') throw new Error('expected ok');
      expect(r.installDiscrepancyPct).toBeLessThan(-1);
      expect(r.installDiscrepancyPct).toBeGreaterThan(-9);
    }
  });

  it('returns daily rows when asked', async () => {
    const out = await call<GetAttributionDataOutput>('get_attribution_data', {
      attributionCampaignIds: [attrIdOf('cmp_018')],
      period: LAST_7,
      includeDaily: true,
    });
    const r = out.results[0];
    expect(r?.status === 'ok' && r.daily?.length).toBe(7);
  });

  it('reports an unknown attribution id as not_found without failing the whole call', async () => {
    const out = await call<GetAttributionDataOutput>('get_attribution_data', {
      attributionCampaignIds: ['af_0000', attrIdOf('cmp_001')],
      period: LAST_7,
    });
    expect(out.results.map((r) => r.status)).toEqual(['error', 'ok']);
    expect(out.results[0]?.status === 'error' && out.results[0].error.code).toBe('not_found');
    expect(out.dataGaps).toHaveLength(1);
  });

  it('rejects internal ids at validation time (must resolve first)', async () => {
    const r = await runTool('get_attribution_data', { attributionCampaignIds: ['cmp_007'], period: LAST_7 }, h.ctx, 5000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('invalid_input');
  });
});

describe('get_fraud_signals', () => {
  it('S1: flags cmp_007 for high suspicious installs and click injection last week', async () => {
    const out = await call<GetFraudSignalsOutput>('get_fraud_signals', { campaignIds: ['cmp_007'], period: LAST_7 });
    const c = out.campaigns[0];
    expect(c?.country).toBe('US');
    expect(c?.avgSuspiciousInstallRate).toBeGreaterThan(0.25);
    expect(c?.medianCtitSeconds).toBeLessThan(8);
    expect(c?.flags).toEqual(['high_suspicious_install_rate', 'click_injection_suspected', 'repeatedly_flagged_sub_publishers']);
    expect(c?.flaggedSubPublishers).toEqual(['sp_4471', 'sp_9020']);
  });

  it('S1: cmp_007 was clean the week before', async () => {
    const out = await call<GetFraudSignalsOutput>('get_fraud_signals', { campaignIds: ['cmp_007'], period: PREV_7 });
    expect(out.campaigns[0]?.flags).toEqual([]);
  });

  it('only cmp_007 is flagged across all campaigns last week (S6: no invented problems)', async () => {
    const out = await call<GetFraudSignalsOutput>('get_fraud_signals', { period: LAST_7, onlyFlagged: true });
    expect(out.campaigns.map((c) => c.campaignId)).toEqual(['cmp_007']);
  });

  it('lists campaigns without data (paused cmp_021)', async () => {
    const out = await call<GetFraudSignalsOutput>('get_fraud_signals', { campaignIds: ['cmp_021', 'cmp_001'], period: LAST_7 });
    expect(out.campaignsWithoutData).toEqual(['cmp_021']);
    expect(out.campaigns.map((c) => c.campaignId)).toEqual(['cmp_001']);
  });

  it('caps daily rows at 50', async () => {
    const out = await call<GetFraudSignalsOutput>('get_fraud_signals', { period: LAST_7, includeDaily: true });
    const dailyRows = out.campaigns.reduce((s, c) => s + (c.daily?.length ?? 0), 0);
    expect(dailyRows).toBe(50);
    expect(out.truncated).toBe(true);
  });
});

describe('list_campaigns search', () => {
  it('finds campaigns by app or advertiser name, case-insensitively', async () => {
    const byApp = await call<ListCampaignsOutput>('list_campaigns', { search: 'tile tide', country: 'us' });
    expect(byApp.campaigns.map((c) => c.id)).toEqual(['cmp_007']);
    const byAdvertiser = await call<ListCampaignsOutput>('list_campaigns', { search: 'Tidewater' });
    expect(byAdvertiser.campaigns.map((c) => c.id)).toEqual(['cmp_007', 'cmp_008', 'cmp_009']);
  });
});
