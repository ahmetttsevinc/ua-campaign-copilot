import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFraudStore, FRAUD_CSV_FILE, parseFraudCsv } from '../src/sources/fraudCsv/loader.js';

const HEADER = 'date,campaign_id,country,suspicious_install_rate,median_ctit_seconds,flagged_sub_publishers';

describe('parseFraudCsv', () => {
  it('parses rows, numbers and the semicolon-separated sub-publisher list', () => {
    const rows = parseFraudCsv(`${HEADER}\n2026-11-01,cmp_007,US,0.31,5.6,sp_1;sp_2\n2026-11-01,cmp_001,US,0.02,90,\n`);
    expect(rows).toEqual([
      { date: '2026-11-01', campaignId: 'cmp_007', country: 'US', suspiciousInstallRate: 0.31, medianCtitSeconds: 5.6, flaggedSubPublishers: ['sp_1', 'sp_2'] },
      { date: '2026-11-01', campaignId: 'cmp_001', country: 'US', suspiciousInstallRate: 0.02, medianCtitSeconds: 90, flaggedSubPublishers: [] },
    ]);
  });

  it('rejects a changed header, wrong column count and invalid values with the line number', () => {
    expect(() => parseFraudCsv('date,campaign\n')).toThrow(/header/);
    expect(() => parseFraudCsv(`${HEADER}\n2026-11-01,cmp_007,US\n`)).toThrow(/line 2: expected 6 columns/);
    expect(() => parseFraudCsv(`${HEADER}\n2026-11-01,cmp_007,US,1.7,5,\n`)).toThrow(/line 2: suspiciousInstallRate/);
  });
});

describe('createFraudStore', () => {
  it('explains how to fix a missing file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'fraud-'));
    await expect(createFraudStore(dir).rows()).rejects.toThrow(/pnpm db:seed/);
  });

  it('reloads when the file changes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'fraud-'));
    const file = path.join(dir, FRAUD_CSV_FILE);
    const store = createFraudStore(dir);
    await writeFile(file, `${HEADER}\n2026-11-01,cmp_001,US,0.02,90,\n`);
    expect(await store.rows()).toHaveLength(1);
    await writeFile(file, `${HEADER}\n2026-11-01,cmp_001,US,0.02,90,\n2026-11-01,cmp_002,DE,0.03,80,\n`);
    await utimes(file, new Date(), new Date(Date.now() + 5000));
    expect(await store.rows()).toHaveLength(2);
  });
});
