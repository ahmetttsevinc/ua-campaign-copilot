import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const advertisers = pgTable('advertisers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  vertical: text('vertical', { enum: ['gaming', 'fintech', 'shopping', 'streaming'] }).notNull(),
});

export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey(),
  advertiserId: text('advertiser_id')
    .notNull()
    .references(() => advertisers.id),
  name: text('name').notNull(),
  country: text('country').notNull(),
  platform: text('platform', { enum: ['ios', 'android'] }).notNull(),
  payoutModel: text('payout_model', { enum: ['cpi', 'cpa'] }).notNull(),
  status: text('status', { enum: ['active', 'paused'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

// CPI and ROAS are deliberately not stored: they are ratios of sums and must be
// recomputed per aggregation window, otherwise averaging daily ratios gives wrong answers.
export const campaignDailyMetrics = pgTable(
  'campaign_daily_metrics',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    date: date('date', { mode: 'string' }).notNull(),
    spendUsd: numeric('spend_usd', { precision: 12, scale: 2 }).notNull(),
    clicks: integer('clicks').notNull(),
    installs: integer('installs').notNull(),
    revenueUsd: numeric('revenue_usd', { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.date] }),
    // Most questions are "all campaigns in a date window"; the PK leads with campaign_id,
    // so it cannot serve range scans on date alone.
    index('campaign_daily_metrics_date_idx').on(t.date),
  ],
);

export const campaignIdMappings = pgTable(
  'campaign_id_mappings',
  {
    internalCampaignId: text('internal_campaign_id')
      .notNull()
      .references(() => campaigns.id),
    attributionCampaignId: text('attribution_campaign_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.internalCampaignId, t.attributionCampaignId] }),
    // Lookups go both ways (internal -> attribution and back).
    unique('campaign_id_mappings_attribution_uq').on(t.attributionCampaignId),
  ],
);

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  question: text('question').notNull(),
  status: text('status', {
    enum: ['running', 'completed', 'failed', 'failed_validation', 'budget_exceeded', 'max_steps_exceeded'],
  }).notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  finalAnswer: jsonb('final_answer'),
  error: text('error'),
  totalInputTokens: integer('total_input_tokens').notNull().default(0),
  totalOutputTokens: integer('total_output_tokens').notNull().default(0),
  totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  totalLatencyMs: integer('total_latency_ms').notNull().default(0),
  retries: integer('retries').notNull().default(0),
  repairs: integer('repairs').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const agentSteps = pgTable(
  'agent_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    stepNumber: integer('step_number').notNull(),
    type: text('type', { enum: ['llm_call', 'tool_call', 'repair'] }).notNull(),
    toolName: text('tool_name'),
    input: jsonb('input'),
    output: jsonb('output'),
    isError: boolean('is_error').notNull().default(false),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    latencyMs: integer('latency_ms').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Doubles as an idempotency guard: a resumed run cannot write the same step twice.
    unique('agent_steps_run_step_uq').on(t.runId, t.stepNumber),
    // Unique above covers run_id lookups already, but PRD asks for an explicit index and it
    // documents the main access path (load all steps of a run).
    index('agent_steps_run_id_idx').on(t.runId),
  ],
);
