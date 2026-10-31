// Dev helper: run one tool exactly as the agent would and print the result.
//   pnpm tool compare_campaign_periods '{"before":{"from":"2026-10-19","to":"2026-10-25"},"after":{"from":"2026-10-26","to":"2026-11-01"},"limit":3}'
// get_attribution_data needs the API server running (it calls the mock over HTTP).
import { getConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { createFraudStore } from '../sources/fraudCsv/loader.js';
import { runTool, TOOLS } from '../tools/index.js';

const [name, json = '{}'] = process.argv.slice(2);
if (!name) {
  console.error(`Usage: pnpm tool <name> '<json input>'\nTools: ${TOOLS.map((t) => t.name).join(', ')}`);
  process.exit(1);
}
const config = getConfig();
const { db, sql } = createDb(config.DATABASE_URL);
try {
  const result = await runTool(
    name,
    JSON.parse(json) as unknown,
    { db, fraud: createFraudStore(config.DATA_DIR), attributionBaseUrl: config.ATTRIBUTION_BASE_URL },
    config.TOOL_TIMEOUT_MS,
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}
