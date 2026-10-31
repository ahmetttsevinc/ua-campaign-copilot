import type { Period } from '@copilot/shared';
import { z } from 'zod';

const StatsResponse = z.object({
  campaign_id: z.string(),
  stats: z.array(
    z.object({
      date: z.string(),
      installs: z.number().int(),
      d1_retention: z.number(),
      d7_retention: z.number(),
      purchase_events: z.number().int(),
    }),
  ),
});
export type AttributionStat = z.infer<typeof StatsResponse>['stats'][number];

export class AttributionUnavailableError extends Error {}

export type FetchStatsResult = { status: 'ok'; stats: AttributionStat[] } | { status: 'not_found' };

const MAX_ATTEMPTS = 3;
// The whole tool call must fit in TOOL_TIMEOUT_MS (5 s default) even at 800 ms latency per
// attempt, so backoff stays short and the vendor's retry-after is deliberately not honoured.
const BASE_BACKOFF_MS = 100;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

/** HTTP client for the (mock) attribution vendor. Retries transient failures only. */
export async function fetchAttributionStats(
  baseUrl: string,
  attributionId: string,
  period: Period,
  signal: AbortSignal,
): Promise<FetchStatsResult & { attempts: number }> {
  const url = `${baseUrl}/campaigns/${encodeURIComponent(attributionId)}/stats?from=${period.from}&to=${period.to}`;
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal });
      if (res.status === 404) return { status: 'not_found', attempts: attempt };
      if (res.ok) {
        return { status: 'ok', stats: StatsResponse.parse(await res.json()).stats, attempts: attempt };
      }
      lastError = `HTTP ${res.status}`;
      // 4xx other than 404 means we sent a bad request; retrying will not help.
      if (res.status < 500 && res.status !== 429) throw new AttributionUnavailableError(`Attribution API rejected request: ${lastError}`);
    } catch (err) {
      if (signal.aborted || err instanceof AttributionUnavailableError) throw err;
      // Node's fetch hides the real reason (ECONNREFUSED, ENOTFOUND...) in `cause`; surface it.
      const cause = err instanceof Error ? (err.cause as { code?: string } | undefined)?.code : undefined;
      lastError = `${err instanceof Error ? err.message : String(err)}${cause ? `: ${cause} at ${baseUrl}` : ''}`;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1) * (0.5 + Math.random()), signal);
  }
  throw new AttributionUnavailableError(`Attribution API unavailable after ${MAX_ATTEMPTS} attempts (${lastError})`);
}
