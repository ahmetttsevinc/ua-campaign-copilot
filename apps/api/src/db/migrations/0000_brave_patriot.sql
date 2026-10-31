CREATE TABLE "advertisers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"vertical" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"final_answer" jsonb,
	"error" text,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"total_latency_ms" integer DEFAULT 0 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"repairs" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_number" integer NOT NULL,
	"type" text NOT NULL,
	"tool_name" text,
	"input" jsonb,
	"output" jsonb,
	"is_error" boolean DEFAULT false NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_steps_run_step_uq" UNIQUE("run_id","step_number")
);
--> statement-breakpoint
CREATE TABLE "campaign_daily_metrics" (
	"campaign_id" text NOT NULL,
	"date" date NOT NULL,
	"spend_usd" numeric(12, 2) NOT NULL,
	"clicks" integer NOT NULL,
	"installs" integer NOT NULL,
	"revenue_usd" numeric(12, 2) NOT NULL,
	CONSTRAINT "campaign_daily_metrics_campaign_id_date_pk" PRIMARY KEY("campaign_id","date")
);
--> statement-breakpoint
CREATE TABLE "campaign_id_mappings" (
	"internal_campaign_id" text NOT NULL,
	"attribution_campaign_id" text NOT NULL,
	CONSTRAINT "campaign_id_mappings_internal_campaign_id_attribution_campaign_id_pk" PRIMARY KEY("internal_campaign_id","attribution_campaign_id"),
	CONSTRAINT "campaign_id_mappings_attribution_uq" UNIQUE("attribution_campaign_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"advertiser_id" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"platform" text NOT NULL,
	"payout_model" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_daily_metrics" ADD CONSTRAINT "campaign_daily_metrics_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_id_mappings" ADD CONSTRAINT "campaign_id_mappings_internal_campaign_id_campaigns_id_fk" FOREIGN KEY ("internal_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_steps_run_id_idx" ON "agent_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "campaign_daily_metrics_date_idx" ON "campaign_daily_metrics" USING btree ("date");