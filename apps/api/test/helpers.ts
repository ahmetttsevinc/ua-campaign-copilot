import os from 'node:os';
import path from 'node:path';
import { parseConfig, type Config } from '../src/config.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://copilot:copilot@localhost:5432/copilot_test';

// Tests write the generated CSV/JSON here so they never touch the dev data files.
export const TEST_DATA_DIR = path.join(os.tmpdir(), 'ua-copilot-test-data');

export function testConfig(overrides: Record<string, string> = {}): Config {
  return parseConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    LLM_PROVIDER: 'fake',
    DATA_DIR: TEST_DATA_DIR,
    // No injected faults or latency unless a test asks for them.
    ATTRIBUTION_FAILURE_RATE: '0',
    ATTRIBUTION_LATENCY_MS_MIN: '0',
    ATTRIBUTION_LATENCY_MS_MAX: '0',
    ...overrides,
  });
}
