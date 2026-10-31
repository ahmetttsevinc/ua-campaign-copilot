import {
  type AttributionResult,
  type AttributionTotals,
  GetAttributionDataInput,
  GetAttributionDataOutput,
  MAX_ROWS,
  type Period,
} from '@copilot/shared';
import { mapLimit } from '../lib/concurrency.js';
import { pctChange, ratio } from '../lib/numbers.js';
import { type AttributionStat, AttributionUnavailableError, fetchAttributionStats } from '../sources/attributionMock/client.js';
import { queryMetrics } from './metricsQuery.js';
import { lookupMappings } from './resolveCampaignId.js';
import { defineTool, type ToolContext } from './types.js';

function totals(stats: AttributionStat[]): AttributionTotals {
  const installs = stats.reduce((s, r) => s + r.installs, 0);
  // Install-weighted: a 10-install day must not count as much as a 1,000-install day.
  const weighted = (key: 'd1_retention' | 'd7_retention') =>
    installs === 0 ? null : ratio(stats.reduce((s, r) => s + r[key] * r.installs, 0) / installs);
  return {
    installs,
    d1Retention: weighted('d1_retention'),
    d7Retention: weighted('d7_retention'),
    purchaseEvents: stats.reduce((s, r) => s + r.purchase_events, 0),
    days: stats.length,
  };
}

type Fetched = { status: 'ok'; stats: AttributionStat[] } | { status: 'error'; code: 'not_found' | 'upstream_unavailable'; message: string };

async function safeFetch(ctx: ToolContext, budget: AbortSignal, id: string, period: Period): Promise<Fetched> {
  if (budget.aborted) return { status: 'error', code: 'upstream_unavailable', message: 'Not fetched: the attribution provider was too slow to finish within the time limit' };
  try {
    const r = await fetchAttributionStats(ctx.attributionBaseUrl, id, period, AbortSignal.any([ctx.signal, budget]));
    return r.status === 'ok'
      ? { status: 'ok', stats: r.stats }
      : { status: 'error', code: 'not_found', message: `Attribution provider does not know campaign ${id}` };
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    if (budget.aborted) {
      return { status: 'error', code: 'upstream_unavailable', message: 'Not fetched: the attribution provider was too slow to finish within the time limit' };
    }
    if (err instanceof AttributionUnavailableError) return { status: 'error', code: 'upstream_unavailable', message: err.message };
    throw err;
  }
}

export const getAttributionData = defineTool({
  name: 'get_attribution_data',
  description:
    'Fetch data from the external attribution provider: attributed installs, D1/D7 retention and purchase ' +
    'events. Takes attribution ids (af_...), NOT internal ids: call resolve_campaign_id first. Use it for user ' +
    'quality questions (retention) and to check whether internal install counts match the attribution provider ' +
    '(installDiscrepancyPct; about -2% to -8% is normal). Pass baselinePeriod to get changes versus an earlier ' +
    'period. The provider is sometimes unavailable: failed campaigns come back with status "error" and are listed ' +
    'in dataGaps, which you must report as a caveat rather than guess.',
  input: GetAttributionDataInput,
  output: GetAttributionDataOutput,
  async execute(input, ctx) {
    const mappings = await lookupMappings(ctx.db, input.attributionCampaignIds);
    const internalByAttr = new Map(mappings.map((m) => [m.attribution_campaign_id, m.internal_campaign_id]));
    const internalIds = [...new Set(mappings.map((m) => m.internal_campaign_id))];
    const internalTotals = internalIds.length ? await queryMetrics(ctx.db, internalIds, input.period, 'total') : [];
    const internalInstallsById = new Map(internalTotals.map((r) => [r.campaignId, r.installs]));

    // Stop waiting at the deadline: whatever has not arrived becomes a reported gap.
    const budget = new AbortController();
    const timer = setTimeout(() => budget.abort(), Math.max(0, ctx.deadlineAt - Date.now()));

    let dailyBudget = MAX_ROWS;
    let truncated = false;

    const results = await mapLimit(input.attributionCampaignIds, 5, async (id): Promise<AttributionResult> => {
      const [current, baseline] = await Promise.all([
        safeFetch(ctx, budget.signal, id, input.period),
        input.baselinePeriod ? safeFetch(ctx, budget.signal, id, input.baselinePeriod) : Promise.resolve(undefined),
      ]);
      if (current.status === 'error') return { status: 'error', attributionCampaignId: id, error: { code: current.code, message: current.message } };
      if (baseline?.status === 'error') return { status: 'error', attributionCampaignId: id, error: { code: baseline.code, message: `Baseline period: ${baseline.message}` } };

      const period = totals(current.stats);
      const base = baseline ? totals(baseline.stats) : undefined;
      const internalCampaignId = internalByAttr.get(id) ?? null;
      const internalInstalls = internalCampaignId ? (internalInstallsById.get(internalCampaignId) ?? null) : null;

      let daily;
      if (input.includeDaily) {
        const take = current.stats.slice(0, Math.max(0, dailyBudget));
        if (take.length < current.stats.length) truncated = true;
        dailyBudget -= take.length;
        daily = take.map((s) => ({
          date: s.date,
          installs: s.installs,
          d1Retention: s.d1_retention,
          d7Retention: s.d7_retention,
          purchaseEvents: s.purchase_events,
        }));
      }

      return {
        status: 'ok',
        attributionCampaignId: id,
        internalCampaignId,
        period,
        ...(base
          ? {
              baseline: base,
              changePct: {
                installs: pctChange(base.installs, period.installs),
                d1Retention: pctChange(base.d1Retention, period.d1Retention),
                d7Retention: pctChange(base.d7Retention, period.d7Retention),
                purchaseEvents: pctChange(base.purchaseEvents, period.purchaseEvents),
              },
            }
          : {}),
        internalInstalls,
        installDiscrepancyPct: internalInstalls ? pctChange(internalInstalls, period.installs) : null,
        ...(daily ? { daily } : {}),
      };
    }).finally(() => clearTimeout(timer));

    const dataGaps = results.flatMap((r) =>
      r.status === 'error' ? [`${r.attributionCampaignId}${internalByAttr.has(r.attributionCampaignId) ? ` (${internalByAttr.get(r.attributionCampaignId)})` : ''}: ${r.error.message}`] : [],
    );
    return {
      results,
      dataGaps,
      truncated,
      ...(truncated ? { note: `Daily rows capped at ${MAX_ROWS}; request fewer campaigns or a shorter period.` } : {}),
    };
  },
});
