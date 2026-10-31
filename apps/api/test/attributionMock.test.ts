import { afterAll, describe, expect, it } from 'vitest';
import { generateDataset } from '../src/db/seed/generate.js';
import { LAST_7 } from '../src/db/seed/scenarios.js';
import { startHarness, type Harness } from './toolHarness.js';

const harnesses: Harness[] = [];
afterAll(() => Promise.all(harnesses.map((h) => h.close())));
const af = generateDataset().mappings[0]?.attributionCampaignId as string;

describe('mock attribution API', () => {
  it('serves vendor-shaped daily stats for a date range', async () => {
    const h = await startHarness();
    harnesses.push(h);
    const res = await h.app.inject({ url: `/mock/attribution/campaigns/${af}/stats?from=${LAST_7.from}&to=${LAST_7.to}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { campaign_id: string; stats: { date: string; d7_retention: number }[] };
    expect(body.campaign_id).toBe(af);
    expect(body.stats).toHaveLength(7);
    expect(Object.keys(body.stats[0] ?? {}).sort()).toEqual(['d1_retention', 'd7_retention', 'date', 'installs', 'purchase_events']);
  });

  it('returns 404 for unknown ids and 400 for a missing range', async () => {
    const h = await startHarness();
    harnesses.push(h);
    expect((await h.app.inject({ url: `/mock/attribution/campaigns/af_0000/stats?from=2026-10-01&to=2026-10-02` })).statusCode).toBe(404);
    expect((await h.app.inject({ url: `/mock/attribution/campaigns/${af}/stats` })).statusCode).toBe(400);
  });

  it('injects 503s at the configured rate with retry-after', async () => {
    const h = await startHarness({ ATTRIBUTION_FAILURE_RATE: '1' });
    harnesses.push(h);
    const res = await h.app.inject({ url: `/mock/attribution/campaigns/${af}/stats?from=2026-10-01&to=2026-10-02` });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('1');
    expect((res.json() as { error: { code: string } }).error.code).toBe('service_unavailable');
  });

  it('injects latency within the configured range', async () => {
    const h = await startHarness({ ATTRIBUTION_LATENCY_MS_MIN: '150', ATTRIBUTION_LATENCY_MS_MAX: '200' });
    harnesses.push(h);
    const t = performance.now();
    await h.app.inject({ url: `/mock/attribution/campaigns/${af}/stats?from=2026-10-01&to=2026-10-02` });
    expect(performance.now() - t).toBeGreaterThanOrEqual(145);
  });
});
