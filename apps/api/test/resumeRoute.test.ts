import { AgentEvent, AgentRun, ApiError, CreateRunResponse } from '@copilot/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { failOrphanedRuns, createRun as createRunRow, getRunRow } from '../src/agent/persistence.js';
import { FakeProvider } from '../src/llm/fake.js';
import { demoScript } from '../src/llm/fakeScripts.js';
import { startHarness, type Harness } from './toolHarness.js';

let h: Harness;
beforeAll(async () => {
  // Turn-indexed fake, exactly like LLM_PROVIDER=fake in dev: a fresh instance per request.
  h = await startHarness({ KILL_AFTER_STEP: '3' }, { providerFactory: () => new FakeProvider(demoScript().map((t) => ({ ...t, delayMs: 1 })), 'fake', 'turn') });
});
afterAll(() => h.close());

const events = async (runId: string) =>
  (await h.app.inject({ url: `/runs/${runId}/events` })).body
    .split('\n\n')
    .filter((c) => c.startsWith('data: '))
    .map((c) => AgentEvent.parse(JSON.parse(c.slice(6))));
const getRun = async (runId: string) => AgentRun.parse((await h.app.inject({ url: `/runs/${runId}` })).json());

describe('crash and resume (KILL_AFTER_STEP)', () => {
  it('crashes after step 3, resumes, and completes without re-running completed tools', async () => {
    const created = await h.app.inject({ method: 'POST', url: '/runs', payload: { question: 'Which campaigns dropped?', provider: 'fake' } });
    const { runId } = CreateRunResponse.parse(created.json());

    expect((await events(runId)).at(-1)?.type).toBe('run_failed');
    const crashed = await getRun(runId);
    expect(crashed).toMatchObject({ status: 'failed', resumable: true, error: expect.stringContaining('Simulated crash after step 3') });
    expect(crashed.steps.map((s) => s.stepNumber)).toEqual([1, 2, 3]);

    const resumed = await h.app.inject({ method: 'POST', url: `/runs/${runId}/resume` });
    expect(resumed.statusCode).toBe(202);
    expect((await events(runId)).at(-1)?.type).toBe('run_completed');

    const done = await getRun(runId);
    expect(done.status).toBe('completed');
    expect(done.steps.map((s) => `${s.stepNumber}:${s.toolName ?? s.type}`)).toEqual([
      '1:llm_call',
      '2:compare_campaign_periods',
      '3:llm_call',
      '4:get_fraud_signals',
      '5:llm_call',
    ]);
    // The trace can show where the run picked up again.
    expect(done.steps[3]?.input).toMatchObject({ resumedAfterStep: 3 });
    expect(done.steps.filter((s) => (s.input as { resumedAfterStep?: number }).resumedAfterStep !== undefined)).toHaveLength(1);
    expect(done.finalAnswer?.findings[0]?.campaignId).toBe('cmp_007');
  });

  it('refuses to resume completed or unknown runs', async () => {
    const created = CreateRunResponse.parse((await h.app.inject({ method: 'POST', url: '/runs', payload: { question: 'Any drops?', provider: 'fake' } })).json());
    await events(created.runId);
    await h.app.inject({ method: 'POST', url: `/runs/${created.runId}/resume` });
    await events(created.runId);
    const again = await h.app.inject({ method: 'POST', url: `/runs/${created.runId}/resume` });
    expect(again.statusCode).toBe(409);
    expect(ApiError.parse(again.json()).error.code).toBe('not_resumable');

    const missing = await h.app.inject({ method: 'POST', url: '/runs/00000000-0000-4000-8000-000000000000/resume' });
    expect(missing.statusCode).toBe(404);
  });
});

describe('failOrphanedRuns', () => {
  it('turns runs left "running" by a dead process into resumable failures', async () => {
    const orphan = await createRunRow(h.db, { question: 'orphan', provider: 'fake', model: 'fake', promptVersion: 'v1.0.0' });
    expect(await failOrphanedRuns(h.db)).toBeGreaterThanOrEqual(1);
    const row = await getRunRow(h.db, orphan.id);
    expect(row).toMatchObject({ status: 'failed', error: expect.stringMatching(/^Interrupted/) });
    expect((await getRun(orphan.id)).resumable).toBe(true);
  });
});
