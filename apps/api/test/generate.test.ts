import { describe, expect, it } from 'vitest';
import { CAMPAIGNS } from '../src/db/seed/catalog.js';
import { generateDataset, type MetricRow } from '../src/db/seed/generate.js';
import { DATA_END_DATE, HEALTHY_CONTROL_IDS, INJECTIONS, LAST_7, PREV_7, SCENARIOS } from '../src/db/seed/scenarios.js';

const data = generateDataset();

function sumWindow(campaignId: string, w: { from: string; to: string }) {
  const rows = data.metrics.filter((m: MetricRow) => m.campaignId === campaignId && m.date >= w.from && m.date <= w.to);
  const s = rows.reduce(
    (acc, r) => ({ spend: acc.spend + r.spendUsd, installs: acc.installs + r.installs, revenue: acc.revenue + r.revenueUsd }),
    { spend: 0, installs: 0, revenue: 0 },
  );
  return { ...s, roas: s.revenue / s.spend, cpi: s.spend / s.installs, days: rows.length };
}
const pct = (after: number, before: number) => (after / before - 1) * 100;

function attributionFor(campaignId: string) {
  const mapping = data.mappings.find((m) => m.internalCampaignId === campaignId);
  if (!mapping) throw new Error(`no mapping for ${campaignId}`);
  return data.attribution[mapping.attributionCampaignId] ?? [];
}

describe('generateDataset', () => {
  it('is deterministic', () => {
    expect(generateDataset()).toEqual(data);
  });

  it('covers 24 campaigns over 60 days ending on DATA_END_DATE', () => {
    expect(CAMPAIGNS).toHaveLength(24);
    const dates = [...new Set(data.metrics.map((m) => m.date))].sort();
    expect(dates).toHaveLength(60);
    expect(dates.at(-1)).toBe(DATA_END_DATE);
  });

  it('gives every campaign a unique attribution id', () => {
    const ids = data.mappings.map((m) => m.attributionCampaignId);
    expect(new Set(ids).size).toBe(24);
    for (const id of ids) expect(id).toMatch(/^af_[0-9a-f]{4}$/);
  });

  it('S1: cmp_007 ROAS drops ~45-50% with stable installs and a fraud spike', () => {
    const before = sumWindow('cmp_007', PREV_7);
    const after = sumWindow('cmp_007', LAST_7);
    expect(pct(after.roas, before.roas)).toBeLessThan(-40);
    expect(Math.abs(pct(after.installs, before.installs))).toBeLessThan(8);
    const fraud = data.fraud.filter((f) => f.campaign_id === 'cmp_007' && f.date >= LAST_7.from);
    expect(fraud).toHaveLength(7);
    for (const f of fraud) {
      expect(f.suspicious_install_rate).toBeGreaterThanOrEqual(0.28);
      expect(f.median_ctit_seconds).toBeLessThan(8);
    }
  });

  it('S1: cmp_007 is the single biggest ROAS drop, ahead of cmp_012', () => {
    const drops = CAMPAIGNS.filter((c) => c.id !== INJECTIONS.S5.campaignId)
      .map((c) => ({ id: c.id, chg: pct(sumWindow(c.id, LAST_7).roas, sumWindow(c.id, PREV_7).roas) }))
      .sort((a, b) => a.chg - b.chg);
    expect(drops.slice(0, 2).map((d) => d.id)).toEqual(['cmp_007', 'cmp_012']);
  });

  it('S2: cmp_012 spend roughly doubles while installs rise ~10%', () => {
    const before = sumWindow('cmp_012', PREV_7);
    const after = sumWindow('cmp_012', LAST_7);
    expect(after.spend / before.spend).toBeGreaterThan(1.8);
    expect(pct(after.installs, before.installs)).toBeGreaterThan(3);
    expect(pct(after.installs, before.installs)).toBeLessThan(18);
    expect(pct(after.cpi, before.cpi)).toBeGreaterThan(60);
  });

  it('S3: cmp_018 installs stable but D7 retention halves in attribution data', () => {
    expect(Math.abs(pct(sumWindow('cmp_018', LAST_7).installs, sumWindow('cmp_018', PREV_7).installs))).toBeLessThan(8);
    const rows = attributionFor('cmp_018');
    const avgD7 = (w: { from: string; to: string }) => {
      const r = rows.filter((x) => x.date >= w.from && x.date <= w.to);
      return r.reduce((a, x) => a + x.d7_retention, 0) / r.length;
    };
    const ratio = avgD7(LAST_7) / avgD7(PREV_7);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  it('S4: cmp_003 attribution reports ~40% fewer installs only in the last 5 days', () => {
    const internal = new Map(data.metrics.filter((m) => m.campaignId === 'cmp_003').map((m) => [m.date, m.installs]));
    for (const row of attributionFor('cmp_003')) {
      const ratio = row.installs / (internal.get(row.date) ?? NaN);
      if (row.date >= INJECTIONS.S4.window.from) {
        expect(ratio).toBeCloseTo(0.6, 1);
      } else {
        // Normal attribution discrepancy of 2-8% (rounding can push small days slightly outside).
        expect(ratio).toBeGreaterThan(0.88);
        expect(ratio).toBeLessThanOrEqual(1);
      }
    }
  });

  it('S5: cmp_021 has no activity for the last 10 days', () => {
    const rows = data.metrics.filter((m) => m.campaignId === 'cmp_021');
    expect((rows.at(-1)?.date ?? '') < INJECTIONS.S5.pausedFrom).toBe(true);
    expect(rows).toHaveLength(50);
    expect(data.fraud.some((f) => f.campaign_id === 'cmp_021' && f.date >= INJECTIONS.S5.pausedFrom)).toBe(false);
  });

  it('S6: healthy controls move less than 10% week over week on ROAS, CPI and installs', () => {
    for (const id of HEALTHY_CONTROL_IDS) {
      const before = sumWindow(id, PREV_7);
      const after = sumWindow(id, LAST_7);
      expect(Math.abs(pct(after.roas, before.roas)), `${id} roas`).toBeLessThan(10);
      expect(Math.abs(pct(after.cpi, before.cpi)), `${id} cpi`).toBeLessThan(10);
      expect(Math.abs(pct(after.installs, before.installs)), `${id} installs`).toBeLessThan(10);
    }
  });

  it('documents every scenario S1 to S6', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  });
});
