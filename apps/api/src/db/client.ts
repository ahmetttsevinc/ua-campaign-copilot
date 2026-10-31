import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(url: string) {
  // max 10 is plenty for one process; keeps the dev container from running out of slots during tests.
  const sql = postgres(url, { max: 10, onnotice: () => undefined });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>['db'];
export type Sql = ReturnType<typeof createDb>['sql'];
