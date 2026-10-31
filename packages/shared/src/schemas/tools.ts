import { z } from 'zod';
import { CampaignStatus, IsoDate, Platform, Vertical } from './domain.js';

/**
 * Input and output schemas for every agent tool. Inputs are what the LLM sends (validated
 * before execution); outputs are validated after execution so a tool bug can never feed the
 * model malformed data. Field descriptions are written for the model: they end up in the
 * JSON schema sent to the provider.
 */

export const MAX_ROWS = 50;

export const Period = z
  .object({
    from: IsoDate.describe('Inclusive start date, YYYY-MM-DD'),
    to: IsoDate.describe('Inclusive end date, YYYY-MM-DD'),
  })
  .refine((p) => p.from <= p.to, { message: '`from` must be on or before `to`' });
export type Period = z.infer<typeof Period>;

const CampaignId = z.string().regex(/^cmp_\d{3}$/, 'Internal campaign ids look like cmp_007');
const AttributionId = z.string().regex(/^af_[0-9a-f]{4}$/, 'Attribution ids look like af_9f3a');

/** Shared tail on list-like outputs so the model knows when it is not seeing everything. */
const Truncation = {
  truncated: z.boolean(),
  note: z.string().optional(),
};

// ---------- list_campaigns ----------

export const ListCampaignsInput = z
  .object({
    search: z
      .string()
      .min(2)
      .optional()
      .describe('Case-insensitive text matched against campaign, app and advertiser names, e.g. "tile tide"'),
    advertiserId: z.string().optional().describe('Advertiser id such as adv_03 (not a name; use search for names)'),
    country: z.string().length(2).toUpperCase().optional().describe('ISO-2 country code, e.g. DE'),
    platform: Platform.optional(),
    status: CampaignStatus.optional(),
    vertical: Vertical.optional(),
  })
  .strict();
export type ListCampaignsInput = z.infer<typeof ListCampaignsInput>;

export const ListCampaignsOutput = z.object({
  campaigns: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      advertiserId: z.string(),
      advertiserName: z.string(),
      vertical: Vertical,
      country: z.string(),
      platform: Platform,
      payoutModel: z.enum(['cpi', 'cpa']),
      status: CampaignStatus,
      lastActiveDate: z.string().nullable(),
    }),
  ),
  total: z.number().int(),
  ...Truncation,
});
export type ListCampaignsOutput = z.infer<typeof ListCampaignsOutput>;

// ---------- shared metric shapes ----------

export const MetricTotals = z.object({
  spendUsd: z.number(),
  clicks: z.number().int(),
  installs: z.number().int(),
  revenueUsd: z.number(),
  cpi: z.number().nullable().describe('spend / installs; null when there are no installs'),
  roas: z.number().nullable().describe('revenue / spend; null when there is no spend'),
  activeDays: z.number().int().describe('Days with data in the window'),
});
export type MetricTotals = z.infer<typeof MetricTotals>;

export const ComparableMetric = z.enum(['roas', 'cpi', 'spendUsd', 'installs', 'revenueUsd', 'clicks']);
export type ComparableMetric = z.infer<typeof ComparableMetric>;

// ---------- get_campaign_metrics ----------

export const GetCampaignMetricsInput = z
  .object({
    campaignIds: z.array(CampaignId).min(1).max(MAX_ROWS),
    period: Period,
    granularity: z.enum(['daily', 'total']).default('total'),
  })
  .strict();
export type GetCampaignMetricsInput = z.infer<typeof GetCampaignMetricsInput>;

export const GetCampaignMetricsOutput = z.object({
  period: Period,
  granularity: z.enum(['daily', 'total']),
  rows: z.array(
    MetricTotals.extend({
      campaignId: z.string(),
      campaignName: z.string(),
      status: CampaignStatus,
      date: z.string().nullable().describe('Set for daily rows, null for totals'),
    }),
  ),
  unknownCampaignIds: z.array(z.string()),
  ...Truncation,
});
export type GetCampaignMetricsOutput = z.infer<typeof GetCampaignMetricsOutput>;

// ---------- compare_campaign_periods ----------

export const CompareCampaignPeriodsInput = z
  .object({
    campaignIds: z
      .array(CampaignId)
      .min(1)
      .max(MAX_ROWS)
      .optional()
      .describe('Omit to compare every campaign'),
    before: Period.describe('Baseline period, e.g. the week before'),
    after: Period.describe('Period to evaluate, e.g. last week'),
    sortBy: ComparableMetric.default('roas'),
    order: z
      .enum(['largest_decrease_first', 'largest_increase_first'])
      .default('largest_decrease_first')
      .describe('Ordering by percentage change of sortBy'),
    limit: z.number().int().min(1).max(MAX_ROWS).default(10),
  })
  .strict();
export type CompareCampaignPeriodsInput = z.infer<typeof CompareCampaignPeriodsInput>;

const MetricChanges = z.object({
  spendUsd: z.number().nullable(),
  clicks: z.number().nullable(),
  installs: z.number().nullable(),
  revenueUsd: z.number().nullable(),
  cpi: z.number().nullable(),
  roas: z.number().nullable(),
});

export const CompareCampaignPeriodsOutput = z.object({
  before: Period,
  after: Period,
  sortBy: ComparableMetric,
  order: z.enum(['largest_decrease_first', 'largest_increase_first']),
  rows: z.array(
    z.object({
      rank: z.number().int(),
      campaignId: z.string(),
      campaignName: z.string(),
      status: CampaignStatus,
      before: MetricTotals,
      after: MetricTotals,
      changeAbs: MetricChanges.describe('after - before'),
      changePct: MetricChanges.describe('(after - before) / before * 100; null when before is 0 or null'),
    }),
  ),
  unknownCampaignIds: z.array(z.string()),
  totalCompared: z.number().int(),
  ...Truncation,
});
export type CompareCampaignPeriodsOutput = z.infer<typeof CompareCampaignPeriodsOutput>;

// ---------- resolve_campaign_id ----------

export const ResolveCampaignIdInput = z
  .object({
    ids: z
      .array(z.string().min(1))
      .min(1)
      .max(MAX_ROWS)
      .describe('Internal ids (cmp_...) and/or attribution ids (af_...), in any mix'),
  })
  .strict();
export type ResolveCampaignIdInput = z.infer<typeof ResolveCampaignIdInput>;

export const ResolveCampaignIdOutput = z.object({
  resolved: z.array(
    z.object({
      input: z.string(),
      internalCampaignId: z.string(),
      attributionCampaignId: z.string(),
      campaignName: z.string(),
    }),
  ),
  unresolved: z.array(z.string()),
});
export type ResolveCampaignIdOutput = z.infer<typeof ResolveCampaignIdOutput>;

// ---------- get_attribution_data ----------

export const GetAttributionDataInput = z
  .object({
    attributionCampaignIds: z.array(AttributionId).min(1).max(25),
    period: Period,
    baselinePeriod: Period.optional().describe('Optional earlier period to compute changes against'),
    includeDaily: z.boolean().default(false),
  })
  .strict();
export type GetAttributionDataInput = z.infer<typeof GetAttributionDataInput>;

export const AttributionTotals = z.object({
  installs: z.number().int(),
  d1Retention: z.number().nullable().describe('Install-weighted average, 0..1'),
  d7Retention: z.number().nullable().describe('Install-weighted average, 0..1'),
  purchaseEvents: z.number().int(),
  days: z.number().int(),
});
export type AttributionTotals = z.infer<typeof AttributionTotals>;

export const AttributionDaily = z.object({
  date: z.string(),
  installs: z.number().int(),
  d1Retention: z.number(),
  d7Retention: z.number(),
  purchaseEvents: z.number().int(),
});

export const AttributionResult = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    attributionCampaignId: z.string(),
    internalCampaignId: z.string().nullable(),
    period: AttributionTotals,
    baseline: AttributionTotals.optional(),
    changePct: z
      .object({
        installs: z.number().nullable(),
        d1Retention: z.number().nullable(),
        d7Retention: z.number().nullable(),
        purchaseEvents: z.number().nullable(),
      })
      .optional(),
    internalInstalls: z.number().int().nullable().describe('Installs our own DB recorded for the same period'),
    installDiscrepancyPct: z
      .number()
      .nullable()
      .describe('(attribution - internal) / internal * 100. Normal range is about -2 to -8'),
    daily: z.array(AttributionDaily).optional(),
  }),
  z.object({
    status: z.literal('error'),
    attributionCampaignId: z.string(),
    error: z.object({ code: z.enum(['not_found', 'upstream_unavailable']), message: z.string() }),
  }),
]);
export type AttributionResult = z.infer<typeof AttributionResult>;

export const GetAttributionDataOutput = z.object({
  results: z.array(AttributionResult),
  dataGaps: z.array(z.string()).describe('Human-readable list of data that could not be fetched'),
  ...Truncation,
});
export type GetAttributionDataOutput = z.infer<typeof GetAttributionDataOutput>;

// ---------- get_fraud_signals ----------

export const GetFraudSignalsInput = z
  .object({
    campaignIds: z.array(CampaignId).min(1).max(MAX_ROWS).optional().describe('Omit for all campaigns'),
    period: Period,
    country: z.string().length(2).toUpperCase().optional(),
    onlyFlagged: z.boolean().default(false).describe('Only return campaigns with at least one fraud flag'),
    includeDaily: z.boolean().default(false),
  })
  .strict();
export type GetFraudSignalsInput = z.infer<typeof GetFraudSignalsInput>;

export const FraudFlag = z.enum(['high_suspicious_install_rate', 'click_injection_suspected', 'repeatedly_flagged_sub_publishers']);

export const GetFraudSignalsOutput = z.object({
  period: Period,
  thresholds: z.object({
    suspiciousInstallRate: z.number(),
    clickInjectionCtitSeconds: z.number(),
  }),
  campaigns: z.array(
    z.object({
      campaignId: z.string(),
      country: z.string(),
      days: z.number().int(),
      avgSuspiciousInstallRate: z.number(),
      maxSuspiciousInstallRate: z.number(),
      medianCtitSeconds: z.number().describe('Median of the daily median click-to-install times'),
      minCtitSeconds: z.number(),
      flaggedSubPublishers: z.array(z.string()),
      flags: z.array(FraudFlag),
      daily: z
        .array(
          z.object({
            date: z.string(),
            suspiciousInstallRate: z.number(),
            medianCtitSeconds: z.number(),
            flaggedSubPublishers: z.array(z.string()),
          }),
        )
        .optional(),
    }),
  ),
  campaignsWithoutData: z.array(z.string()),
  ...Truncation,
});
export type GetFraudSignalsOutput = z.infer<typeof GetFraudSignalsOutput>;
