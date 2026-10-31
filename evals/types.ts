import { z } from 'zod';

const Window = z.object({ from: z.string(), to: z.string() });

/** One eval case. Expectations are data, so new cases need no new code. */
export const EvalCase = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  scenario: z.enum(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'ADV']),
  question: z.string().min(3),
  /** 'down' points the agent at an attribution mock that always returns 503. */
  attribution: z.enum(['up', 'down']).default('up'),
  expected: z.object({
    /** Campaigns that must appear in findings, optionally with the direction of their main change. */
    findCampaigns: z
      .array(z.object({ campaignId: z.string(), direction: z.enum(['up', 'down']).optional(), metricAnyOf: z.array(z.string()).optional() }))
      .default([]),
    /** At least one must appear in the answer text (summary, causes, caveats). */
    causeKeywords: z.array(z.string()).default([]),
    /** Campaigns that must not be reported as findings, unless the cause mentions `unlessMentions`. */
    mustNotFlag: z.array(z.object({ campaignId: z.string(), unlessMentions: z.string().optional() })).default([]),
    /** At least one must appear in the caveats. */
    caveatMentions: z.array(z.string()).default([]),
    /** Findings for these campaigns are allowed only if they show no material change (|changePct| < 10). */
    quietCampaigns: z.array(z.string()).default([]),
    emptyFindings: z.boolean().default(false),
    maxConfidence: z.enum(['low', 'medium', 'high']).optional(),
    /** Plain-language description used by the LLM judge. */
    description: z.string(),
  }),
  tools: z.object({
    required: z.array(z.string()).default([]),
    /** LLM calls allowed before the case counts as inefficient. */
    maxLlmSteps: z.number().int().default(8),
  }),
  /** Candidate periods for the numeric scorer; a finding passes if it matches any of them. */
  truthWindows: z.array(z.object({ before: Window, after: Window })).optional(),
});
export type EvalCase = z.infer<typeof EvalCase>;
export type EvalCaseInput = z.input<typeof EvalCase>;

export type ScoreStatus = 'pass' | 'fail' | 'skip';
export interface Score {
  status: ScoreStatus;
  details: string[];
}
export type ScorerName = 'expectations' | 'numeric' | 'toolUsage' | 'judge';
