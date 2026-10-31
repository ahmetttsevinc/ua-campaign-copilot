import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('parseConfig', () => {
  it('applies PRD defaults', () => {
    const c = parseConfig({ ...base, LLM_PROVIDER: 'fake' });
    expect(c.AGENT_MAX_STEPS).toBe(10);
    expect(c.AGENT_MAX_TOKENS).toBe(120_000);
    expect(c.AGENT_MAX_WALL_MS).toBe(90_000);
    expect(c.TOOL_TIMEOUT_MS).toBe(5_000);
    expect(c.ATTRIBUTION_FAILURE_RATE).toBe(0.1);
    expect(c.KILL_AFTER_STEP).toBeUndefined();
  });

  it('treats empty strings from .env as unset', () => {
    const c = parseConfig({ ...base, LLM_PROVIDER: 'fake', KILL_AFTER_STEP: '', NEBIUS_API_KEY: '', NEBIUS_MODEL: '  ' });
    expect(c.KILL_AFTER_STEP).toBeUndefined();
    expect(c.NEBIUS_API_KEY).toBeUndefined();
    // Blank falls back to the default model rather than an empty string.
    expect(c.NEBIUS_MODEL).toBe('Qwen/Qwen3-235B-A22B-Instruct-2507');
  });

  it('parses KILL_AFTER_STEP as a number', () => {
    expect(parseConfig({ ...base, LLM_PROVIDER: 'fake', KILL_AFTER_STEP: '3' }).KILL_AFTER_STEP).toBe(3);
  });

  it('starts without provider keys (users can enter one in the app)', () => {
    expect(parseConfig({ ...base, LLM_PROVIDER: 'anthropic' }).ANTHROPIC_API_KEY).toBeUndefined();
    expect(parseConfig({ ...base, LLM_PROVIDER: 'nebius' }).NEBIUS_API_KEY).toBeUndefined();
    const nebius = parseConfig({ ...base, LLM_PROVIDER: 'nebius', NEBIUS_API_KEY: 'k' });
    expect(nebius.NEBIUS_BASE_URL).toBe('https://api.tokenfactory.nebius.com/v1');
    expect(nebius.NEBIUS_MODEL).toBe('Qwen/Qwen3-235B-A22B-Instruct-2507');
  });

  it('rejects a missing or malformed DATABASE_URL', () => {
    expect(() => parseConfig({ LLM_PROVIDER: 'fake' })).toThrow(/DATABASE_URL/);
    expect(() => parseConfig({ LLM_PROVIDER: 'fake', DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });

  it('rejects invalid numbers and ranges', () => {
    expect(() => parseConfig({ ...base, LLM_PROVIDER: 'fake', ATTRIBUTION_FAILURE_RATE: '1.5' })).toThrow();
    expect(() =>
      parseConfig({ ...base, LLM_PROVIDER: 'fake', ATTRIBUTION_LATENCY_MS_MIN: '900', ATTRIBUTION_LATENCY_MS_MAX: '100' }),
    ).toThrow(/ATTRIBUTION_LATENCY_MS_MIN/);
  });

  it('forbids crash simulation in production', () => {
    expect(() => parseConfig({ ...base, LLM_PROVIDER: 'fake', NODE_ENV: 'production', KILL_AFTER_STEP: '2' })).toThrow(
      /KILL_AFTER_STEP/,
    );
  });
});
