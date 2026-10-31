import { buildApp, defaultDeps } from './app.js';
import { getConfig } from './config.js';
import { failOrphanedRuns } from './agent/persistence.js';
import { createDb } from './db/client.js';
import { createFraudStore } from './sources/fraudCsv/loader.js';

let config;
try {
  config = getConfig();
} catch (err) {
  // Fail fast with a readable message instead of a stack trace.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const { db, sql } = createDb(config.DATABASE_URL);
const app = buildApp(defaultDeps({ config, db, fraud: createFraudStore(config.DATA_DIR) }), { logger: true });

const shutdown = async () => {
  await app.close();
  await sql.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (!config.ANTHROPIC_API_KEY && !config.NEBIUS_API_KEY && config.LLM_PROVIDER !== 'fake') {
  app.log.warn('No LLM API keys configured: users will be asked for a key in the app');
}
const orphaned = await failOrphanedRuns(db);
if (orphaned > 0) app.log.warn({ orphaned }, 'marked runs interrupted by a previous shutdown as failed (resumable)');
if (config.KILL_AFTER_STEP !== undefined) app.log.warn(`KILL_AFTER_STEP=${config.KILL_AFTER_STEP}: every run will crash after that step (resume demo)`);

await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
