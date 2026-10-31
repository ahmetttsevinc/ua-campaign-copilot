/**
 * USD per million tokens. Plain config so prices can be updated without touching logic.
 * Sources (checked 2026-10-31): Anthropic pricing table; Nebius GET /v1/models `pricing` field.
 */
interface Price {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Some models charge a higher rate when the prompt exceeds a size threshold. */
  longContext?: { aboveInputTokens: number; inputPerMTok: number; outputPerMTok: number };
}

export const PRICES: Record<string, Price> = {
  // Anthropic
  'claude-haiku-5-5': {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    longContext: { aboveInputTokens: 100_000, inputPerMTok: 0.5, outputPerMTok: 2.5 },
  },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20 },
  // Nebius Token Factory
  'Qwen/Qwen3-235B-A22B-Instruct-2507': { inputPerMTok: 0.2, outputPerMTok: 0.6 },
  'Qwen/Qwen3-30B-A3B-Instruct-2507': { inputPerMTok: 0.1, outputPerMTok: 0.3 },
  'openai/gpt-oss-120b': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'deepseek-ai/DeepSeek-V4-Flash-0731': { inputPerMTok: 0.14, outputPerMTok: 0.28 },
  // Deterministic tests
  fake: { inputPerMTok: 1, outputPerMTok: 2 },
};

export function isPriced(model: string): boolean {
  return model in PRICES;
}

/** Cost of one LLM call. Unknown models cost 0 rather than crash a run; /health and logs flag them. */
export function costUsd(model: string, usage: { inputTokens: number; outputTokens: number }): number {
  const p = PRICES[model];
  if (!p) return 0;
  const rate = p.longContext && usage.inputTokens > p.longContext.aboveInputTokens ? p.longContext : p;
  const cost = (usage.inputTokens * rate.inputPerMTok + usage.outputTokens * rate.outputPerMTok) / 1_000_000;
  return Math.round(cost * 1e8) / 1e8;
}
