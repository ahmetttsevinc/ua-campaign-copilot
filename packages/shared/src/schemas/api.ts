import { z } from 'zod';
import { Campaign, CampaignStatus, Platform } from './domain.js';

/** One error shape for every route (PRD section 9). */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const ListCampaignsQuery = z
  .object({
    advertiserId: z.string().optional(),
    country: z.string().length(2).toUpperCase().optional(),
    platform: Platform.optional(),
    status: CampaignStatus.optional(),
  })
  .strict();
export type ListCampaignsQuery = z.infer<typeof ListCampaignsQuery>;

export const ListCampaignsResponse = z.object({
  campaigns: z.array(Campaign),
  dataEndDate: z.string(),
});
export type ListCampaignsResponse = z.infer<typeof ListCampaignsResponse>;

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.object({ ok: z.boolean(), error: z.string().optional() }),
  /** The server's default provider. */
  provider: z.object({
    name: z.enum(['anthropic', 'nebius', 'fake']),
    model: z.string(),
    configured: z.boolean(),
  }),
  /** Every selectable provider; serverKey=false means the UI must ask the user for a key. */
  providers: z.array(z.object({ name: z.enum(['anthropic', 'nebius', 'fake']), model: z.string(), serverKey: z.boolean() })),
});

/** Header carrying a user-supplied provider key for one request. Never persisted or logged. */
export const API_KEY_HEADER = 'x-llm-api-key';
export type HealthResponse = z.infer<typeof HealthResponse>;
