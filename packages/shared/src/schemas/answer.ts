import { z } from 'zod';

/** The only shape a run may present as a successful answer (PRD 7.5). */
export const Finding = z.object({
  campaignId: z.string(),
  campaignName: z.string(),
  metric: z.string(),
  before: z.number().nullable(),
  after: z.number().nullable(),
  changePct: z.number().nullable(),
  likelyCause: z.string(),
  evidence: z.array(z.string()),
});
export type Finding = z.infer<typeof Finding>;

export const FinalAnswer = z.object({
  summary: z.string().min(1),
  findings: z.array(Finding),
  caveats: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type FinalAnswer = z.infer<typeof FinalAnswer>;
