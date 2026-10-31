import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { type AppDeps, buildApp, type BuildAppOptions, defaultDeps } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { createFraudStore, type FraudStore } from '../src/sources/fraudCsv/loader.js';
import type { ToolContext, ToolEnv } from '../src/tools/types.js';
import { testConfig, TEST_DATA_DIR, TEST_DATABASE_URL } from './helpers.js';

export interface Harness {
  app: FastifyInstance;
  db: Db;
  ctx: ToolEnv;
  close(): Promise<void>;
}

/**
 * Boots the real app on an ephemeral port so tools reach the attribution mock over actual
 * HTTP, exactly as in production.
 */
export async function startHarness(
  envOverrides: Record<string, string> = {},
  opts: BuildAppOptions & { fraud?: FraudStore; providerFactory?: AppDeps['providerFactory'] } = {},
): Promise<Harness> {
  const { db, sql } = createDb(TEST_DATABASE_URL);
  const config = testConfig(envOverrides);
  const fraud = opts.fraud ?? createFraudStore(TEST_DATA_DIR);
  const deps = defaultDeps({ config, db, fraud });
  const app = buildApp(opts.providerFactory ? { ...deps, providerFactory: opts.providerFactory } : deps, opts);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  // The port is only known after listen; agent runs started through routes read it from config.
  config.ATTRIBUTION_BASE_URL = `http://127.0.0.1:${port}/mock/attribution`;
  return {
    app,
    db,
    ctx: { db, fraud, attributionBaseUrl: `http://127.0.0.1:${port}/mock/attribution` },
    async close() {
      await app.close();
      await sql.end();
    },
  };
}

export const ctxWithSignal = (ctx: Harness['ctx']): ToolContext => ({ ...ctx, signal: new AbortController().signal, deadlineAt: Date.now() + 5000 });
