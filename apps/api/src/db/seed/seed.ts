import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql as rawSql } from 'drizzle-orm';
import { createDb, type Db } from '../client.js';
import { advertisers, campaignDailyMetrics, campaignIdMappings, campaigns } from '../schema.js';
import { addDays } from '../../lib/dates.js';
import { ADVERTISERS, CAMPAIGNS } from './catalog.js';
import { fraudRowsToCsv, generateDataset } from './generate.js';
import { DATA_START_DATE, INJECTIONS } from './scenarios.js';
import { ATTRIBUTION_FILE } from '../../sources/attributionMock/plugin.js';
import { FRAUD_CSV_FILE } from '../../sources/fraudCsv/loader.js';

export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../data', import.meta.url));

/**
 * Idempotent: wipes domain tables (not agent history) and rewrites them plus the two
 * "external" files. The attribution data lives in a file, not Postgres, because it
 * belongs to another system that only the mock API should read.
 */
export async function seed(db: Db, dataDir = DEFAULT_DATA_DIR): Promise<void> {
  const data = generateDataset();

  await db.transaction(async (tx) => {
    await tx.execute(
      rawSql`TRUNCATE campaign_daily_metrics, campaign_id_mappings, campaigns, advertisers RESTART IDENTITY CASCADE`,
    );
    await tx.insert(advertisers).values([...ADVERTISERS]);
    await tx.insert(campaigns).values(
      CAMPAIGNS.map((c, i) => ({
        ...c,
        status: c.id === INJECTIONS.S5.campaignId ? ('paused' as const) : ('active' as const),
        // Staggered creation dates, all before the data window starts.
        createdAt: new Date(`${addDays(DATA_START_DATE, -3 * (i + 1))}T09:00:00Z`),
      })),
    );
    await tx.insert(campaignIdMappings).values(data.mappings);
    // Chunked to stay well under Postgres' 65k bind-parameter limit.
    for (let i = 0; i < data.metrics.length; i += 500) {
      await tx.insert(campaignDailyMetrics).values(
        data.metrics.slice(i, i + 500).map((m) => ({
          ...m,
          spendUsd: m.spendUsd.toFixed(2),
          revenueUsd: m.revenueUsd.toFixed(2),
        })),
      );
    }
  });

  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, FRAUD_CSV_FILE), fraudRowsToCsv(data.fraud));
  await writeFile(path.join(dataDir, ATTRIBUTION_FILE), `${JSON.stringify({ campaigns: data.attribution }, null, 1)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
  const { db, sql } = createDb(url);
  try {
    await seed(db);
    console.log(`Seeded ${CAMPAIGNS.length} campaigns; files written to ${DEFAULT_DATA_DIR}`);
  } finally {
    await sql.end();
  }
}
