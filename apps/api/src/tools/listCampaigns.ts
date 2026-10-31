import { ListCampaignsInput, ListCampaignsOutput, MAX_ROWS } from '@copilot/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { defineTool } from './types.js';

const Row = z.object({
  id: z.string(),
  name: z.string(),
  advertiser_id: z.string(),
  advertiser_name: z.string(),
  vertical: z.enum(['gaming', 'fintech', 'shopping', 'streaming']),
  country: z.string(),
  platform: z.enum(['ios', 'android']),
  payout_model: z.enum(['cpi', 'cpa']),
  status: z.enum(['active', 'paused']),
  created_at: z.coerce.date(),
  last_active_date: z.string().nullable(),
});
export type CampaignRow = z.infer<typeof Row>;

/** Shared by the tool and the GET /campaigns route so both apply filters identically. */
export async function queryCampaigns(db: Db, f: ListCampaignsInput): Promise<CampaignRow[]> {
  const rows = await db.execute(sql`
    SELECT c.id, c.name, c.advertiser_id, a.name AS advertiser_name, a.vertical,
           c.country, c.platform, c.payout_model, c.status, c.created_at,
           (SELECT max(m.date)::text FROM campaign_daily_metrics m WHERE m.campaign_id = c.id) AS last_active_date
    FROM campaigns c
    JOIN advertisers a ON a.id = c.advertiser_id
    WHERE (${f.search ?? null}::text IS NULL
           OR c.name ILIKE '%' || ${f.search ?? null} || '%' OR a.name ILIKE '%' || ${f.search ?? null} || '%')
      AND (${f.advertiserId ?? null}::text IS NULL OR c.advertiser_id = ${f.advertiserId ?? null})
      AND (${f.country ?? null}::text IS NULL OR c.country = ${f.country ?? null})
      AND (${f.platform ?? null}::text IS NULL OR c.platform = ${f.platform ?? null})
      AND (${f.status ?? null}::text IS NULL OR c.status = ${f.status ?? null})
      AND (${f.vertical ?? null}::text IS NULL OR a.vertical = ${f.vertical ?? null})
    ORDER BY c.id`);
  return z.array(Row).parse(rows);
}

export const listCampaigns = defineTool({
  name: 'list_campaigns',
  description:
    'List campaigns with their advertiser, country, platform, status (active/paused) and lastActiveDate. ' +
    'Use it to discover campaign ids, to find campaigns the user names in words (pass `search`, e.g. "tile tide"), ' +
    'to check whether a campaign exists, or to check whether it is paused ' +
    'before calling a drop in activity a performance problem. Does not return any performance metrics.',
  input: ListCampaignsInput,
  output: ListCampaignsOutput,
  async execute(input, { db }) {
    const rows = await queryCampaigns(db, input);
    return {
      campaigns: rows.slice(0, MAX_ROWS).map((r) => ({
        id: r.id,
        name: r.name,
        advertiserId: r.advertiser_id,
        advertiserName: r.advertiser_name,
        vertical: r.vertical,
        country: r.country,
        platform: r.platform,
        payoutModel: r.payout_model,
        status: r.status,
        lastActiveDate: r.last_active_date,
      })),
      total: rows.length,
      truncated: rows.length > MAX_ROWS,
      ...(rows.length > MAX_ROWS ? { note: `Showing first ${MAX_ROWS} of ${rows.length}; add filters.` } : {}),
    };
  },
});
