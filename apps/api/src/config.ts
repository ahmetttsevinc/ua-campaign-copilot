import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));

// Empty strings from .env ("KEY=") should mean "unset", not "invalid".
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const intWithDefault = (def: number) => z.coerce.number().int().nonnegative().default(def);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
    API_PORT: intWithDefault(3001),
    // Where the seed writes the fraud CSV and the attribution mock's backing file.
    DATA_DIR: optionalString.transform((v) => v ?? DEFAULT_DATA_DIR),
    // The attribution tool calls the mock over real HTTP, as it would a vendor API.
    ATTRIBUTION_BASE_URL: optionalString,

    LLM_PROVIDER: z.enum(['anthropic', 'nebius', 'fake']).default('anthropic'),
    ANTHROPIC_API_KEY: optionalString,
    // Haiku 5.5 by default to keep runs cheap; Sonnet 5.5 is one env change away.
    ANTHROPIC_MODEL: z.string().default('claude-haiku-5-5'),
    ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
    NEBIUS_API_KEY: optionalString,
    // Verified against the Token Factory docs and GET /v1/models on 2026-10-31.
    NEBIUS_BASE_URL: optionalString.transform((v) => v ?? 'https://api.tokenfactory.nebius.com/v1'),
    NEBIUS_MODEL: optionalString.transform((v) => v ?? 'Qwen/Qwen3-235B-A22B-Instruct-2507'),
    LLM_TIMEOUT_MS: intWithDefault(60_000),

    JUDGE_PROVIDER: z.enum(['anthropic', 'nebius']).default('anthropic'),
    JUDGE_MODEL: z.string().default('claude-haiku-5-5'),
    MAX_RETRIES: intWithDefault(3).describe('Attempts per LLM call, including the first'),

    AGENT_MAX_STEPS: intWithDefault(10),
    // PRD default was 50k; raised to 120k after real runs on broad questions needed 55-65k
    // (each call resends the conversation). Worst case on Haiku is about $0.012 per run.
    AGENT_MAX_TOKENS: intWithDefault(120_000),
    AGENT_MAX_WALL_MS: intWithDefault(90_000),
    TOOL_TIMEOUT_MS: intWithDefault(5_000),

    ATTRIBUTION_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    ATTRIBUTION_LATENCY_MS_MIN: intWithDefault(200),
    ATTRIBUTION_LATENCY_MS_MAX: intWithDefault(800),

    KILL_AFTER_STEP: optionalString.pipe(z.coerce.number<string | undefined>().int().positive().optional()),
  })
  .superRefine((env, ctx) => {
    // API keys are deliberately optional: without one the UI asks the user for a key, which
    // is sent per request and never stored. Everything else still fails fast.
    if (env.ATTRIBUTION_LATENCY_MS_MIN > env.ATTRIBUTION_LATENCY_MS_MAX) {
      ctx.addIssue({ code: 'custom', path: ['ATTRIBUTION_LATENCY_MS_MIN'], message: 'must be <= ATTRIBUTION_LATENCY_MS_MAX' });
    }
    if (env.KILL_AFTER_STEP !== undefined && env.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['KILL_AFTER_STEP'], message: 'dev-only crash simulation, not allowed in production' });
    }
  });

type ParsedEnv = z.infer<typeof EnvSchema>;
export type Config = ParsedEnv & { ATTRIBUTION_BASE_URL: string };

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}\nSee .env.example.`);
  }
  const data = result.data;
  return {
    ...data,
    ATTRIBUTION_BASE_URL: data.ATTRIBUTION_BASE_URL ?? `http://127.0.0.1:${data.API_PORT}/mock/attribution`,
  };
}

let cached: Config | undefined;
export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}
