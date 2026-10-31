import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Sql } from '../apps/api/src/db/client.js';

/**
 * Independent ground truth for the numeric scorer. Deliberately does NOT reuse tool code:
 * internal metrics come from a hand-written SQL query, vendor metrics from the raw files.
 * If a tool had a bug, the agent would faithfully copy the wrong number and only an
 * independent computation catches it.
 */

export interface Window {
  from: string;
  to: string;
}

export interface Truth {
  /** Candidate true values for a metric (several when a name is ambiguous, e.g. installs). */
  values(campaignId: string, metric: string, w: Window): Promise<number[]>;
}

const norm = (m: string) => m.toLowerCase().replace(/[^a-z0-9]/g, '');

interface AttrRow {
  date: string;
  installs: number;
  d1_retention: number;
  d7_retention: number;
  purchase_events: number;
}

export async function createTruth(sql: Sql, dataDir: string): Promise<Truth> {
  const attribution = JSON.parse(await readFile(path.join(dataDir, 'attribution_stats.json'), 'utf8')) as {
    campaigns: Record<string, AttrRow[]>;
  };
  const fraudLines = (await readFile(path.join(dataDir, 'fraud_signals.csv'), 'utf8')).trim().split('\n').slice(1);
  const fraud = fraudLines.map((l) => {
    const [date, campaignId, , rate, ctit] = l.split(',');
    return { date: date as string, campaignId: campaignId as string, rate: Number(rate), ctit: Number(ctit) };
  });
  const mappings = new Map(
    (await sql<{ internal_campaign_id: string; attribution_campaign_id: string }[]>`SELECT * FROM campaign_id_mappings`).map((m) => [
      m.internal_campaign_id,
      m.attribution_campaign_id,
    ]),
  );

  async function internal(campaignId: string, w: Window) {
    const [r] = await sql<{ spend: number; revenue: number; installs: number; clicks: number }[]>`
      SELECT coalesce(sum(spend_usd), 0)::float8 AS spend, coalesce(sum(revenue_usd), 0)::float8 AS revenue,
             coalesce(sum(installs), 0)::int AS installs, coalesce(sum(clicks), 0)::int AS clicks
      FROM campaign_daily_metrics WHERE campaign_id = ${campaignId} AND date BETWEEN ${w.from}::date AND ${w.to}::date`;
    return r ?? { spend: 0, revenue: 0, installs: 0, clicks: 0 };
  }

  function attributed(campaignId: string, w: Window) {
    const id = mappings.get(campaignId);
    const rows = (id ? attribution.campaigns[id] : undefined)?.filter((r) => r.date >= w.from && r.date <= w.to) ?? [];
    const installs = rows.reduce((s, r) => s + r.installs, 0);
    const weighted = (k: 'd1_retention' | 'd7_retention') => (installs ? rows.reduce((s, r) => s + r[k] * r.installs, 0) / installs : NaN);
    return { installs, d1: weighted('d1_retention'), d7: weighted('d7_retention'), purchases: rows.reduce((s, r) => s + r.purchase_events, 0) };
  }

  return {
    async values(campaignId, metric, w) {
      const m = norm(metric);
      const i = await internal(campaignId, w);
      const a = attributed(campaignId, w);
      const f = fraud.filter((r) => r.campaignId === campaignId && r.date >= w.from && r.date <= w.to);
      const sorted = f.map((r) => r.ctit).sort((x, y) => x - y);
      const mid = Math.floor(sorted.length / 2);
      const medianCtit = sorted.length % 2 ? (sorted[mid] ?? NaN) : ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2;

      const table: Record<string, number[]> = {
        roas: [i.revenue / i.spend],
        cpi: [i.spend / i.installs],
        spend: [i.spend],
        spendusd: [i.spend],
        revenue: [i.revenue],
        revenueusd: [i.revenue],
        clicks: [i.clicks],
        // Ambiguous on purpose: "installs" may be internal or attributed.
        installs: [i.installs, a.installs],
        attributedinstalls: [a.installs],
        internalinstalls: [i.installs],
        d1retention: [a.d1],
        d7retention: [a.d7],
        purchaseevents: [a.purchases],
        purchases: [a.purchases],
        installdiscrepancypct: [((a.installs - i.installs) / i.installs) * 100],
        installdiscrepancy: [((a.installs - i.installs) / i.installs) * 100],
        suspiciousinstallrate: [f.reduce((s, r) => s + r.rate, 0) / f.length],
        avgsuspiciousinstallrate: [f.reduce((s, r) => s + r.rate, 0) / f.length],
        medianctitseconds: [medianCtit],
        ctit: [medianCtit],
      };
      return (table[m] ?? []).filter((v) => Number.isFinite(v));
    },
  };
}
