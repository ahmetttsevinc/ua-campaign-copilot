import { sql as rawSql } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed/seed.js';
import { TEST_DATA_DIR, TEST_DATABASE_URL } from './helpers.js';

export default async function setup() {
  const { db, sql } = createDb(TEST_DATABASE_URL);
  try {
    // Start from an empty schema each run so migrations are exercised too.
    await db.execute(rawSql`DROP SCHEMA IF EXISTS public CASCADE`);
    await db.execute(rawSql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await db.execute(rawSql`CREATE SCHEMA public`);
  } finally {
    await sql.end();
  }
  await runMigrations(TEST_DATABASE_URL);
  const seeded = createDb(TEST_DATABASE_URL);
  try {
    await seed(seeded.db, TEST_DATA_DIR);
  } finally {
    await seeded.sql.end();
  }
}
