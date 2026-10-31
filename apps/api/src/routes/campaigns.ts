import { ListCampaignsQuery, ListCampaignsResponse } from '@copilot/shared';
import type { FastifyInstance } from 'fastify';
import { DATA_END_DATE } from '../db/seed/scenarios.js';
import { queryCampaigns } from '../tools/listCampaigns.js';

export async function campaignRoutes(app: FastifyInstance) {
  app.get('/campaigns', async (req) => {
    const query = ListCampaignsQuery.parse(req.query);
    const rows = await queryCampaigns(app.deps.db, query);
    return ListCampaignsResponse.parse({
      campaigns: rows.map((r) => ({
        id: r.id,
        advertiserId: r.advertiser_id,
        advertiserName: r.advertiser_name,
        vertical: r.vertical,
        name: r.name,
        country: r.country,
        platform: r.platform,
        payoutModel: r.payout_model,
        status: r.status,
        createdAt: r.created_at.toISOString(),
      })),
      dataEndDate: DATA_END_DATE,
    });
  });
}
