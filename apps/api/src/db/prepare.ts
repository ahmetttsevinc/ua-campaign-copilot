import postgres from 'postgres';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { seed } from './seed/seed.js';

/**
 * Creates (if needed), migrates and seeds a database from scratch. Used by the eval runner and
 * the E2E suite so they get their own deterministic copy of the data and never touch dev history.
 */
export async function prepareDatabase(url: string, dataDir: string): Promise<void> {
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  if (!/^[a-z0-9_]+$/i.test(dbName)) throw new Error(`Refusing to create database with unusual name "${dbName}"`);

  // Connect to the maintenance DB to create the target if missing.
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => undefined });
  try {
    const exists = await sql`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (exists.length === 0) await sql.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await sql.end();
  }

  const fresh = createDb(url);
  try {
    // Wipe so every eval/E2E run starts from identical state (including empty run history).
    await fresh.sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  } finally {
    await fresh.sql.end();
  }
  await runMigrations(url);
  const seeded = createDb(url);
  try {
    await seed(seeded.db, dataDir);
  } finally {
    await seeded.sql.end();
  }
}

/** Swaps the database name in a Postgres URL (copilot -> copilot_eval). */
export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  const dataDir = process.env.DATA_DIR;
  if (!url || !dataDir) throw new Error('DATABASE_URL and DATA_DIR are required');
  await prepareDatabase(url, dataDir);
  console.log(`Prepared ${new URL(url).pathname.slice(1)} with data in ${dataDir}`);
}
