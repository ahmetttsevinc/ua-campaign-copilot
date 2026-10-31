import { z } from 'zod';

export const Vertical = z.enum(['gaming', 'fintech', 'shopping', 'streaming']);
export const Platform = z.enum(['ios', 'android']);
export const PayoutModel = z.enum(['cpi', 'cpa']);
export const CampaignStatus = z.enum(['active', 'paused']);

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const Campaign = z.object({
  id: z.string(),
  advertiserId: z.string(),
  advertiserName: z.string(),
  vertical: Vertical,
  name: z.string(),
  country: z.string().length(2),
  platform: Platform,
  payoutModel: PayoutModel,
  status: CampaignStatus,
  createdAt: z.string(),
});
export type Campaign = z.infer<typeof Campaign>;
