import type { MetricTotals, Period } from '@copilot/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { textArray } from '../db/sqlHelpers.js';
import { money, ratio } from '../lib/numbers.js';

const AggRow = z.object({
  campaign_id: z.string(),
  campaign_name: z.string(),
  status: z.enum(['active', 'paused']),
  date: z.string().nullable(),
  spend: z.number(),
  clicks: z.number(),
  installs: z.number(),
  revenue: z.number(),
  cpi: z.number().nullable(),
  roas: z.number().nullable(),
  active_days: z.number(),
});

export interface AggregatedMetrics extends MetricTotals {
  campaignId: string;
  campaignName: string;
  status: 'active' | 'paused';
  date: string | null;
}

/**
 * All metric aggregation happens here, in SQL. CPI and ROAS are ratios of sums over the
 * window (never averages of daily ratios). LEFT JOIN keeps campaigns with no rows in the
 * window (e.g. paused) visible as zeros instead of silently dropping them.
 *
 * @param campaignIds null means every campaign
 */
export async function queryMetrics(
  db: Db,
  campaignIds: string[] | null,
  period: Period,
  granularity: 'daily' | 'total',
): Promise<AggregatedMetrics[]> {
  const idFilter = campaignIds ? sql`WHERE c.id = ANY(${textArray(campaignIds)})` : sql``;
  const daily = granularity === 'daily';
  const rows = await db.execute(sql`
    SELECT c.id AS campaign_id, c.name AS campaign_name, c.status,
           ${daily ? sql`m.date::text` : sql`NULL::text`} AS date,
           COALESCE(sum(m.spend_usd), 0)::float8 AS spend,
           COALESCE(sum(m.clicks), 0)::int AS clicks,
           COALESCE(sum(m.installs), 0)::int AS installs,
           COALESCE(sum(m.revenue_usd), 0)::float8 AS revenue,
           (sum(m.spend_usd) / NULLIF(sum(m.installs), 0))::float8 AS cpi,
           (sum(m.revenue_usd) / NULLIF(sum(m.spend_usd), 0))::float8 AS roas,
           count(m.date)::int AS active_days
    FROM campaigns c
    ${daily ? sql`JOIN` : sql`LEFT JOIN`} campaign_daily_metrics m
      ON m.campaign_id = c.id AND m.date BETWEEN ${period.from}::date AND ${period.to}::date
    ${idFilter}
    GROUP BY c.id${daily ? sql`, m.date` : sql``}
    ORDER BY c.id${daily ? sql`, m.date` : sql``}`);

  return z
    .array(AggRow)
    .parse(rows)
    .map((r) => ({
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      status: r.status,
      date: r.date,
      spendUsd: money(r.spend),
      clicks: r.clicks,
      installs: r.installs,
      revenueUsd: money(r.revenue),
      cpi: r.cpi === null ? null : money(r.cpi),
      roas: r.roas === null ? null : ratio(r.roas),
      activeDays: r.active_days,
    }));
}

export async function existingCampaignIds(db: Db, ids: string[]): Promise<Set<string>> {
  const rows = await db.execute(sql`SELECT id FROM campaigns WHERE id = ANY(${textArray(ids)})`);
  return new Set(z.array(z.object({ id: z.string() })).parse(rows).map((r) => r.id));
}
