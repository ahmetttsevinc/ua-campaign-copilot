import type { AgentRun, FinalAnswer } from '@copilot/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDataGapCheck } from '../src/agent/dataGaps.js';
import { EventBus } from '../src/agent/events.js';
import { isResumable, startRun } from '../src/agent/loop.js';
import { loadRun, type StepRow } from '../src/agent/persistence.js';
import { LAST_7 } from '../src/db/seed/scenarios.js';
import { generateDataset } from '../src/db/seed/generate.js';
import { FakeProvider, fakeFinalTurn, fakeToolCall, fakeToolTurn } from '../src/llm/fake.js';
import { startHarness, type Harness } from './toolHarness.js';

const answer: FinalAnswer = { summary: 'All good.', findings: [], caveats: [], confidence: 'high' };
const toolStep = (output: object, isError = false) => ({ type: 'tool_call', toolName: 'get_attribution_data', isError, output }) as unknown as StepRow;

describe('applyDataGapCheck', () => {
  it('adds a caveat and caps confidence when attribution data was missing', () => {
    const r = applyDataGapCheck(answer, [toolStep({ ref: 'step_2', ok: true, durationMs: 1, output: { dataGaps: ['af_97f2 (cmp_003): Attribution API unavailable after 3 attempts'] } })]);
    expect(r.answer.confidence).toBe('medium');
    expect(r.answer.caveats[0]).toMatch(/could not be fetched.*af_97f2/);
  });

  it('keeps the model caveat when it already reported the gap', () => {
    const reported = { ...answer, confidence: 'low' as const, caveats: ['Attribution data was unavailable for cmp_003.'] };
    const r = applyDataGapCheck(reported, [toolStep({ ref: 'step_2', ok: false, durationMs: 1, error: { code: 'timeout', message: 'Tool timed out' } }, true)]);
    expect(r.added).toBe(false);
    expect(r.answer.caveats).toEqual(reported.caveats);
    expect(r.answer.confidence).toBe('low');
  });

  it('ignores the model’s own input mistakes and runs without gaps', () => {
    const r = applyDataGapCheck(answer, [toolStep({ ref: 'step_2', ok: false, durationMs: 1, error: { code: 'invalid_input', message: 'x' } }, true)]);
    expect(r.answer).toBe(answer);
  });
});

describe('attribution outage end to end', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ ATTRIBUTION_FAILURE_RATE: '1' });
  });
  afterAll(() => h.close());

  it('surfaces the outage in caveats even when the model forgets to', async () => {
    const af = generateDataset().mappings.find((m) => m.internalCampaignId === 'cmp_018')?.attributionCampaignId;
    const provider = new FakeProvider([
      fakeToolTurn(fakeToolCall('get_attribution_data', { attributionCampaignIds: [af], period: LAST_7 })),
      fakeFinalTurn(answer),
    ]);
    const { runId, done } = await startRun(
      {
        db: h.db,
        provider,
        toolCtx: h.ctx,
        events: new EventBus(),
        budget: { maxSteps: 10, maxTokens: 50_000, maxWallMs: 90_000 },
        toolTimeoutMs: 5000,
        retry: { maxAttempts: 3, baseDelayMs: 1, sleep: async () => undefined },
      },
      'Is cmp_018 user quality OK?',
    );
    await done;
    const run = (await loadRun(h.db, runId, isResumable)) as AgentRun;
    expect(run.status).toBe('completed');
    // The model saw the failure as data, not as a crash.
    const fed = provider.requests[1]?.messages.at(-1);
    expect(fed?.role === 'tool_results' && fed.results[0]?.content).toMatch(/upstream_unavailable/);
    expect(run.finalAnswer?.confidence).toBe('medium');
    expect(run.finalAnswer?.caveats.join(' ')).toMatch(/could not be fetched.*cmp_018.*unavailable after 3 attempts/);
  });
});

describe('FakeProvider turn mode', () => {
  it('picks the script entry from the conversation, not from call count', async () => {
    const p = new FakeProvider([fakeFinalTurn('first'), fakeFinalTurn('second')], 'fake', 'turn');
    const r = await p.chat({
      system: '',
      tools: [],
      maxTokens: 10,
      messages: [{ role: 'user', content: 'q' }, { role: 'assistant', toolCalls: [] }, { role: 'user', content: 'again' }],
    });
    expect(r.text).toBe('second');
  });
});
