import { AgentEvent, AgentRun, ApiError, CreateRunResponse, ListRunsResponse } from '@copilot/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeProvider } from '../src/llm/fake.js';
import { demoScript } from '../src/llm/fakeScripts.js';
import { createProvider } from '../src/llm/registry.js';
import { testConfig } from './helpers.js';
import { startHarness, type Harness } from './toolHarness.js';

let h: Harness;
beforeAll(async () => {
  const config = testConfig();
  h = await startHarness({}, { providerFactory: (name) => (name === 'fake' ? new FakeProvider(demoScript().map((t) => ({ ...t, delayMs: 5 }))) : createProvider(name, config)) });
});
afterAll(() => h.close());

function parseSse(body: string): AgentEvent[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => AgentEvent.parse(JSON.parse(chunk.slice('data: '.length))));
}

async function createRun(payload: object) {
  return h.app.inject({ method: 'POST', url: '/runs', payload });
}

describe('POST /runs', () => {
  it('validates the body with the shared error shape', async () => {
    for (const payload of [{}, { question: 'x' }, { question: 'Why?', provider: 'openai' }, { question: 'Why?', extra: 1 }]) {
      const res = await createRun(payload);
      expect(res.statusCode).toBe(400);
      expect(ApiError.parse(res.json()).error.code).toBe('validation_error');
    }
  });

  it('reports a provider that is not configured', async () => {
    const res = await createRun({ question: 'Why did ROAS drop?', provider: 'anthropic' });
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error).toMatchObject({ code: 'provider_not_configured', message: expect.stringMatching(/ANTHROPIC_API_KEY or enter a key/) });
  });

  it('uses a key supplied by the user for that request only, and never stores it', async () => {
    const seen: (string | undefined)[] = [];
    const config = testConfig();
    const k = await startHarness({}, {
      providerFactory: (name, key) => {
        seen.push(key);
        return name === 'fake' ? new FakeProvider(demoScript(), 'fake', 'turn') : createProvider(name, config, key);
      },
    });
    try {
      const secret = 'fake-demo-key-not-real-123';
      const res = await k.app.inject({ method: 'POST', url: '/runs', headers: { 'x-llm-api-key': secret }, payload: { question: 'Any drops?', provider: 'fake' } });
      expect(res.statusCode).toBe(202);
      expect(seen).toEqual([secret]);
      const { runId } = CreateRunResponse.parse(res.json());
      await k.app.inject({ url: `/runs/${runId}/events` });
      const stored = JSON.stringify((await k.app.inject({ url: `/runs/${runId}` })).json());
      expect(stored).not.toContain(secret);

      const short = await k.app.inject({ method: 'POST', url: '/runs', headers: { 'x-llm-api-key': 'abc' }, payload: { question: 'Any drops?', provider: 'fake' } });
      expect(short.statusCode).toBe(400);
      expect(ApiError.parse(short.json()).error.code).toBe('invalid_api_key');
    } finally {
      await k.close();
    }
  });

  it('starts a run, streams it over SSE and persists the result', async () => {
    const res = await createRun({ question: 'Which campaigns had the biggest ROAS drop last week?', provider: 'fake' });
    expect(res.statusCode).toBe(202);
    const { runId } = CreateRunResponse.parse(res.json());

    // inject resolves when the stream closes, i.e. when the run finishes.
    const sse = await h.app.inject({ url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toBe('text/event-stream');
    const events = parseSse(sse.body);
    const completedSteps = events.flatMap((e) => (e.type === 'step_completed' ? [e.step.stepNumber] : []));
    expect(completedSteps).toEqual([1, 2, 3, 4, 5]);
    const last = events.at(-1);
    expect(last?.type).toBe('run_completed');

    const run = AgentRun.parse((await h.app.inject({ url: `/runs/${runId}` })).json());
    expect(run).toMatchObject({ status: 'completed', provider: 'fake', resumable: false });
    expect(run.finalAnswer?.findings.map((f) => f.campaignId)).toEqual(['cmp_007', 'cmp_012']);
    // The demo script's numbers match the seed, so the grounding check keeps confidence high.
    expect(run.finalAnswer?.confidence).toBe('high');

    // A late subscriber gets a full replay and the stream closes immediately.
    const replay = parseSse((await h.app.inject({ url: `/runs/${runId}/events` })).body);
    expect(replay.filter((e) => e.type === 'step_completed')).toHaveLength(5);
    expect(replay.at(-1)?.type).toBe('run_completed');

    const list = ListRunsResponse.parse((await h.app.inject({ url: '/runs?limit=5' })).json());
    expect(list.runs[0]?.id).toBe(runId);
  });
});

describe('GET /runs/:id', () => {
  it('rejects malformed ids and 404s unknown ones', async () => {
    const bad = await h.app.inject({ url: '/runs/not-a-uuid' });
    expect(bad.statusCode).toBe(400);
    const missing = await h.app.inject({ url: '/runs/00000000-0000-4000-8000-000000000000' });
    expect(missing.statusCode).toBe(404);
    expect(ApiError.parse(missing.json()).error.code).toBe('not_found');
    const missingEvents = await h.app.inject({ url: '/runs/00000000-0000-4000-8000-000000000000/events' });
    expect(missingEvents.statusCode).toBe(404);
  });

  it('validates the list limit', async () => {
    expect((await h.app.inject({ url: '/runs?limit=0' })).statusCode).toBe(400);
  });
});
