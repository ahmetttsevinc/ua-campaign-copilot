import { CompareCampaignPeriodsInput, CompareCampaignPeriodsOutput, type MetricTotals } from '@copilot/shared';
import { absChange, pctChange } from '../lib/numbers.js';
import { existingCampaignIds, queryMetrics } from './metricsQuery.js';
import { defineTool } from './types.js';

const METRICS = ['spendUsd', 'clicks', 'installs', 'revenueUsd', 'cpi', 'roas'] as const;
// Money and CPI to cents, ROAS to 4 decimals, counts are integers.
const DIGITS: Record<(typeof METRICS)[number], number> = { spendUsd: 2, clicks: 0, installs: 0, revenueUsd: 2, cpi: 2, roas: 4 };

function changes(before: MetricTotals, after: MetricTotals) {
  const abs = {} as Record<(typeof METRICS)[number], number | null>;
  const pct = {} as Record<(typeof METRICS)[number], number | null>;
  for (const m of METRICS) {
    abs[m] = absChange(before[m], after[m], DIGITS[m]);
    pct[m] = pctChange(before[m], after[m]);
  }
  return { abs, pct };
}

export const compareCampaignPeriods = defineTool({
  name: 'compare_campaign_periods',
  description:
    'The main tool for "what changed" questions. Compares internal metrics (spend, clicks, installs, revenue, ' +
    'CPI, ROAS) between a baseline period (`before`) and a later period (`after`) for some or all campaigns, ' +
    'returns absolute and percentage changes, and ranks campaigns by the percentage change of `sortBy`. ' +
    'Rows whose change cannot be computed (e.g. no activity) are ranked last. It only covers internal data: ' +
    'use get_fraud_signals or get_attribution_data to explain why something changed.',
  input: CompareCampaignPeriodsInput,
  output: CompareCampaignPeriodsOutput,
  async execute(input, { db }) {
    let ids: string[] | null = null;
    let unknownCampaignIds: string[] = [];
    if (input.campaignIds) {
      const known = await existingCampaignIds(db, input.campaignIds);
      unknownCampaignIds = input.campaignIds.filter((id) => !known.has(id));
      ids = [...known];
    }

    const [beforeRows, afterRows] =
      ids && ids.length === 0
        ? [[], []]
        : await Promise.all([queryMetrics(db, ids, input.before, 'total'), queryMetrics(db, ids, input.after, 'total')]);
    const afterById = new Map(afterRows.map((r) => [r.campaignId, r]));

    const strip = ({ campaignId: _c, campaignName: _n, status: _s, date: _d, ...totals }: (typeof beforeRows)[number]) =>
      totals;

    const compared = beforeRows.flatMap((b) => {
      const a = afterById.get(b.campaignId);
      if (!a) return [];
      const before = strip(b);
      const after = strip(a);
      const { abs, pct } = changes(before, after);
      return [{ campaignId: b.campaignId, campaignName: b.campaignName, status: b.status, before, after, changeAbs: abs, changePct: pct }];
    });

    const dir = input.order === 'largest_decrease_first' ? 1 : -1;
    compared.sort((x, y) => {
      const px = x.changePct[input.sortBy];
      const py = y.changePct[input.sortBy];
      if (px === null && py === null) return x.campaignId.localeCompare(y.campaignId);
      if (px === null) return 1;
      if (py === null) return -1;
      return (px - py) * dir || x.campaignId.localeCompare(y.campaignId);
    });

    const rows = compared.slice(0, input.limit).map((r, i) => ({ rank: i + 1, ...r }));
    const truncated = compared.length > input.limit;
    return {
      before: input.before,
      after: input.after,
      sortBy: input.sortBy,
      order: input.order,
      rows,
      unknownCampaignIds,
      totalCompared: compared.length,
      truncated,
      ...(truncated ? { note: `Showing top ${input.limit} of ${compared.length} campaigns by ${input.sortBy} change.` } : {}),
    };
  },
});
