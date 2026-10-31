import { ApiError, HealthResponse, ListCampaignsResponse } from '@copilot/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp, defaultDeps } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { createFraudStore } from '../src/sources/fraudCsv/loader.js';
import { testConfig, TEST_DATA_DIR, TEST_DATABASE_URL } from './helpers.js';

const { db, sql } = createDb(TEST_DATABASE_URL);
const app = buildApp(defaultDeps({ config: testConfig(), db, fraud: createFraudStore(TEST_DATA_DIR) }));
afterAll(async () => {
  await app.close();
  await sql.end();
});

describe('GET /health', () => {
  it('reports db and provider status', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponse.parse(res.json());
    expect(body).toMatchObject({ status: 'ok', db: { ok: true }, provider: { name: 'fake', model: 'fake', configured: true } });
    expect(body.providers).toEqual([
      { name: 'fake', model: 'fake', serverKey: true },
      { name: 'anthropic', model: 'claude-haiku-5-5', serverKey: false },
      { name: 'nebius', model: 'Qwen/Qwen3-235B-A22B-Instruct-2507', serverKey: false },
    ]);
  });
});

describe('GET /campaigns', () => {
  it('returns all 24 campaigns', async () => {
    const res = await app.inject({ method: 'GET', url: '/campaigns' });
    expect(res.statusCode).toBe(200);
    const body = ListCampaignsResponse.parse(res.json());
    expect(body.campaigns).toHaveLength(24);
    expect(body.dataEndDate).toBe('2026-11-01');
    expect(body.campaigns.find((c) => c.id === 'cmp_007')).toMatchObject({
      advertiserName: 'Tidewater Puzzles',
      country: 'US',
      platform: 'android',
      status: 'active',
    });
  });

  it('filters by status and country (case-insensitive)', async () => {
    const paused = ListCampaignsResponse.parse((await app.inject({ url: '/campaigns?status=paused' })).json());
    expect(paused.campaigns.map((c) => c.id)).toEqual(['cmp_021']);
    const de = ListCampaignsResponse.parse((await app.inject({ url: '/campaigns?country=de' })).json());
    expect(de.campaigns.map((c) => c.id)).toEqual(['cmp_002', 'cmp_004', 'cmp_005', 'cmp_018']);
  });

  it('rejects invalid and unknown query params with the shared error shape', async () => {
    for (const url of ['/campaigns?platform=windows', '/campaigns?foo=bar']) {
      const res = await app.inject({ url });
      expect(res.statusCode).toBe(400);
      expect(ApiError.parse(res.json()).error.code).toBe('validation_error');
    }
  });
});

describe('unknown routes', () => {
  it('return 404 with the shared error shape', async () => {
    const res = await app.inject({ url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.code).toBe('not_found');
  });
});
