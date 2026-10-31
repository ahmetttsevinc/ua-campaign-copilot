import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ProviderHttpError } from './provider.js';

export interface ErrorClassification {
  retryable: boolean;
  reason: string;
  retryAfterMs?: number;
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function headerOf(headers: unknown, name: string): string | undefined {
  if (headers && typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  return undefined;
}

function classifyStatus(status: number, message: string, retryAfterMs?: number): ErrorClassification {
  // 408 request timeout, 409 lock conflict, 429 rate limit, 5xx incl. Anthropic's 529 overloaded.
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return { retryable: true, reason: `HTTP ${status}: ${message}`, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  }
  // 400 (validation, context length), 401/403 (auth), 404 (bad model): retrying cannot help.
  return { retryable: false, reason: `HTTP ${status}: ${message}` };
}

/** Decide whether a provider error is transient. Uses the SDKs' typed errors, not string matching. */
export function classifyError(err: unknown): ErrorClassification {
  if (err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError) {
    return { retryable: true, reason: `network: ${err.message}` };
  }
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) {
    if (err.status === undefined) return { retryable: true, reason: `network: ${err.message}` };
    return classifyStatus(err.status, err.message, parseRetryAfter(headerOf(err.headers, 'retry-after')));
  }
  if (err instanceof ProviderHttpError) {
    if (err.status === undefined) return { retryable: true, reason: `network: ${err.message}` };
    return classifyStatus(err.status, err.message, err.retryAfterMs);
  }
  // Unknown errors are most likely our own bugs; retrying would just repeat them.
  return { retryable: false, reason: err instanceof Error ? err.message : String(err) };
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  /** Cap so a hostile retry-after cannot stall a run past its wall-clock budget. */
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
}

export class RetryExhaustedError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly retryErrors: string[],
  ) {
    super(message);
  }
}

/**
 * Exponential backoff with jitter. Returns how many retries happened so the caller can
 * record them in step metadata.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<{ value: T; retries: number; retryErrors: string[] }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const maxDelay = opts.maxDelayMs ?? 20_000;
  const retryErrors: string[] = [];

  for (let attempt = 1; ; attempt++) {
    try {
      return { value: await fn(), retries: attempt - 1, retryErrors };
    } catch (err) {
      const c = classifyError(err);
      if (!c.retryable) throw new RetryExhaustedError(c.reason, attempt, retryErrors);
      retryErrors.push(c.reason);
      if (attempt >= opts.maxAttempts) {
        throw new RetryExhaustedError(`Gave up after ${attempt} attempts: ${c.reason}`, attempt, retryErrors);
      }
      // Jitter spreads retries from concurrent runs so they don't hit the provider in lockstep.
      const backoff = opts.baseDelayMs * 2 ** (attempt - 1) * (0.5 + random());
      const delayMs = Math.min(maxDelay, Math.round(c.retryAfterMs ?? backoff));
      opts.onRetry?.({ attempt, delayMs, reason: c.reason });
      await sleep(delayMs);
    }
  }
}
