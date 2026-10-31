import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against real API + web servers with the scripted FakeProvider, an isolated freshly
 * seeded database (copilot_e2e) and no network calls to any LLM. Two stacks: a normal one, and
 * one with KILL_AFTER_STEP=3 for the crash/resume flow.
 */
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://copilot:copilot@localhost:5432/copilot_e2e';
const apiEnv = (port: number, extra: Record<string, string> = {}) => ({
  NODE_ENV: 'test',
  DATABASE_URL,
  DATA_DIR: '/tmp/ua-copilot-e2e-data',
  API_PORT: String(port),
  LLM_PROVIDER: 'fake',
  ATTRIBUTION_FAILURE_RATE: '0',
  ATTRIBUTION_LATENCY_MS_MIN: '20',
  ATTRIBUTION_LATENCY_MS_MAX: '60',
  ...extra,
});

export const PORTS = { web: 5181, crashWeb: 5182 } as const;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORTS.web}`,
    trace: 'retain-on-failure',
    // Local default: the installed Google Chrome (no browser download). PW_BUNDLED=1 uses Playwright's own Chromium.
    ...(process.env.PW_BUNDLED ? devices['Desktop Chrome'] : { ...devices['Desktop Chrome'], channel: 'chrome' }),
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      // Prepares (wipes, migrates, seeds) the E2E database, then serves the normal API.
      command: 'npx tsx src/db/prepare.ts && npx tsx src/server.ts',
      cwd: '../api',
      env: apiEnv(3101),
      url: 'http://localhost:3101/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Waits for the first API so it never races the database preparation.
      command: 'until curl -sf http://localhost:3101/health >/dev/null; do sleep 0.3; done; npx tsx src/server.ts',
      cwd: '../api',
      env: apiEnv(3102, { KILL_AFTER_STEP: '3' }),
      url: 'http://localhost:3102/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    { command: `npx vite --port ${PORTS.web} --strictPort`, env: { API_PORT: '3101' }, url: `http://localhost:${PORTS.web}`, reuseExistingServer: false },
    { command: `npx vite --port ${PORTS.crashWeb} --strictPort`, env: { API_PORT: '3102' }, url: `http://localhost:${PORTS.crashWeb}`, reuseExistingServer: false },
  ],
});
