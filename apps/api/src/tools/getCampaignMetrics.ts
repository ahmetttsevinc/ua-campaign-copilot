import { GetCampaignMetricsInput, GetCampaignMetricsOutput, MAX_ROWS } from '@copilot/shared';
import { existingCampaignIds, queryMetrics } from './metricsQuery.js';
import { defineTool } from './types.js';

export const getCampaignMetrics = defineTool({
  name: 'get_campaign_metrics',
  description:
    'Internal spend, clicks, installs, revenue, CPI and ROAS for specific campaigns over one date range, as ' +
    'totals or daily rows. Use it to inspect one period or a daily trend. To compare two periods use ' +
    'compare_campaign_periods instead (it computes the changes for you). Unknown ids are listed in ' +
    'unknownCampaignIds. A campaign with activeDays 0 had no activity in the window.',
  input: GetCampaignMetricsInput,
  output: GetCampaignMetricsOutput,
  async execute({ campaignIds, period, granularity }, { db }) {
    const known = await existingCampaignIds(db, campaignIds);
    const unknownCampaignIds = campaignIds.filter((id) => !known.has(id));
    const rows = known.size ? await queryMetrics(db, [...known], period, granularity) : [];
    const truncated = rows.length > MAX_ROWS;
    return {
      period,
      granularity,
      rows: rows.slice(0, MAX_ROWS),
      unknownCampaignIds,
      truncated,
      ...(truncated
        ? { note: `Showing ${MAX_ROWS} of ${rows.length} rows; use granularity "total" or fewer campaigns.` }
        : {}),
    };
  },
});
