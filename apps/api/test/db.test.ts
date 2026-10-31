import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { ATTRIBUTION_FILE } from '../src/sources/attributionMock/plugin.js';
import { FRAUD_CSV_FILE } from '../src/sources/fraudCsv/loader.js';
import { LAST_7, PREV_7 } from '../src/db/seed/scenarios.js';
import { TEST_DATA_DIR, TEST_DATABASE_URL } from './helpers.js';

const { sql } = createDb(TEST_DATABASE_URL);
afterAll(() => sql.end());

describe('seeded database', () => {
  it('has 24 campaigns, one paused', async () => {
    const rows = await sql<{ status: string; n: number }[]>`
      SELECT status, count(*)::int AS n FROM campaigns GROUP BY status ORDER BY status`;
    expect(rows).toEqual([
      { status: 'active', n: 23 },
      { status: 'paused', n: 1 },
    ]);
  });

  it('confirms the S1 anomaly with plain SQL: cmp_007 is the top ROAS drop', async () => {
    const rows = await sql<{ campaign_id: string; roas_change_pct: number }[]>`
      WITH w AS (
        SELECT campaign_id,
          SUM(revenue_usd) FILTER (WHERE date BETWEEN ${PREV_7.from} AND ${PREV_7.to})
            / NULLIF(SUM(spend_usd) FILTER (WHERE date BETWEEN ${PREV_7.from} AND ${PREV_7.to}), 0) AS roas_before,
          SUM(revenue_usd) FILTER (WHERE date BETWEEN ${LAST_7.from} AND ${LAST_7.to})
            / NULLIF(SUM(spend_usd) FILTER (WHERE date BETWEEN ${LAST_7.from} AND ${LAST_7.to}), 0) AS roas_after
        FROM campaign_daily_metrics GROUP BY campaign_id
      )
      SELECT campaign_id, ((roas_after / roas_before - 1) * 100)::float AS roas_change_pct
      FROM w WHERE roas_after IS NOT NULL ORDER BY roas_change_pct ASC LIMIT 1`;
    expect(rows[0]?.campaign_id).toBe('cmp_007');
    expect(rows[0]?.roas_change_pct).toBeLessThan(-40);
  });

  it('has every campaign mapped to an attribution id', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM campaigns c JOIN campaign_id_mappings m ON m.internal_campaign_id = c.id`;
    expect(row?.n).toBe(24);
  });

  it('writes the fraud CSV and attribution file', async () => {
    const csv = await readFile(path.join(TEST_DATA_DIR, FRAUD_CSV_FILE), 'utf8');
    expect(csv.split('\n')[0]).toBe(
      'date,campaign_id,country,suspicious_install_rate,median_ctit_seconds,flagged_sub_publishers',
    );
    expect(csv).toMatch(/2026-11-01,cmp_007,US,0\.\d+,\d(\.\d)?,sp_4471;sp_9020/);
    const attribution = JSON.parse(await readFile(path.join(TEST_DATA_DIR, ATTRIBUTION_FILE), 'utf8')) as {
      campaigns: Record<string, unknown[]>;
    };
    expect(Object.keys(attribution.campaigns)).toHaveLength(24);
  });
});
