import { ResolveCampaignIdInput, ResolveCampaignIdOutput } from '@copilot/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { textArray } from '../db/sqlHelpers.js';
import { defineTool } from './types.js';

const MappingRow = z.object({
  internal_campaign_id: z.string(),
  attribution_campaign_id: z.string(),
  campaign_name: z.string(),
});

export async function lookupMappings(db: Db, ids: string[]) {
  const rows = await db.execute(sql`
    SELECT m.internal_campaign_id, m.attribution_campaign_id, c.name AS campaign_name
    FROM campaign_id_mappings m
    JOIN campaigns c ON c.id = m.internal_campaign_id
    WHERE m.internal_campaign_id = ANY(${textArray(ids)}) OR m.attribution_campaign_id = ANY(${textArray(ids)})`);
  return z.array(MappingRow).parse(rows);
}

export const resolveCampaignId = defineTool({
  name: 'resolve_campaign_id',
  description:
    'Translate between internal campaign ids (cmp_...) and attribution provider ids (af_...). The attribution ' +
    'provider does not know internal ids, so call this before get_attribution_data. Accepts either kind, mixed. ' +
    'Unknown ids are returned in `unresolved` rather than guessed.',
  input: ResolveCampaignIdInput,
  output: ResolveCampaignIdOutput,
  async execute({ ids }, { db }) {
    const rows = await lookupMappings(db, ids);
    const resolved: ResolveCampaignIdOutput['resolved'] = [];
    const unresolved: string[] = [];
    for (const id of ids) {
      const row = rows.find((r) => r.internal_campaign_id === id || r.attribution_campaign_id === id);
      if (row) {
        resolved.push({
          input: id,
          internalCampaignId: row.internal_campaign_id,
          attributionCampaignId: row.attribution_campaign_id,
          campaignName: row.campaign_name,
        });
      } else {
        unresolved.push(id);
      }
    }
    return { resolved, unresolved };
  },
});
