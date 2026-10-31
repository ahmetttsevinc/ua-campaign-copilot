import { afterAll, describe, expect, it } from 'vitest';
import { LAST_7 } from '../src/db/seed/scenarios.js';
import { runTool } from '../src/tools/index.js';
import { startHarness, type Harness } from './toolHarness.js';

const harnesses: Harness[] = [];
afterAll(() => Promise.all(harnesses.map((h) => h.close())));
const harness = async (...args: Parameters<typeof startHarness>) => {
  const h = await startHarness(...args);
  harnesses.push(h);
  return h;
};

describe('runTool', () => {
  it('returns unknown_tool for a tool that does not exist', async () => {
    const h = await harness();
    const r = await runTool('drop_tables', {}, h.ctx, 1000);
    expect(r).toMatchObject({ ok: false, error: { code: 'unknown_tool' } });
  });

  it('returns invalid_input with field paths the model can act on', async () => {
    const h = await harness();
    const r = await runTool('compare_campaign_periods', { before: { from: '2026-10-25', to: '2026-10-19' } }, h.ctx, 1000);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('invalid_input');
    const paths = (r.error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toContain('before');
    expect(paths).toContain('after');
  });

  it('turns exceptions into execution_error instead of throwing', async () => {
    const h = await harness({}, { fraud: { rows: () => Promise.reject(new Error('disk on fire')) } });
    const r = await runTool('get_fraud_signals', { period: LAST_7 }, h.ctx, 1000);
    expect(r).toMatchObject({ ok: false, error: { code: 'execution_error', message: 'disk on fire' } });
  });

  it('times out tools that hang', async () => {
    const hanging = { rows: () => new Promise<never>(() => undefined) };
    const h = await harness({}, { fraud: hanging });
    const r = await runTool('get_fraud_signals', { period: LAST_7 }, h.ctx, 100);
    expect(r).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(r.durationMs).toBeLessThan(400);
  });

  it('returns partial attribution results with gaps instead of timing out on a slow vendor', async () => {
    const h = await harness({ ATTRIBUTION_LATENCY_MS_MIN: '500', ATTRIBUTION_LATENCY_MS_MAX: '500' });
    const r = await runTool('get_attribution_data', { attributionCampaignIds: ['af_0000'], period: LAST_7 }, h.ctx, 300);
    expect(r.ok).toBe(true);
    expect(r.durationMs).toBeLessThan(300);
    const out = (r as { output: { results: { status: string }[]; dataGaps: string[] } }).output;
    expect(out.results[0]?.status).toBe('error');
    expect(out.dataGaps[0]).toMatch(/too slow to finish within the time limit/);
  });
});

describe('attribution fault handling', () => {
  it('retries a transient 503 and succeeds', async () => {
    // The mock draws random() twice per request: latency, then failure. First request fails, rest succeed.
    let calls = 0;
    const h = await harness({ ATTRIBUTION_FAILURE_RATE: '0.5' }, { attributionRandom: () => (calls++ === 1 ? 0 : 0.99) });
    const ids = (await runTool('resolve_campaign_id', { ids: ['cmp_018'] }, h.ctx, 1000)) as {
      ok: true;
      output: { resolved: { attributionCampaignId: string }[] };
    };
    const af = ids.output.resolved[0]?.attributionCampaignId;
    const r = await runTool('get_attribution_data', { attributionCampaignIds: [af], period: LAST_7 }, h.ctx, 5000);
    expect(r.ok).toBe(true);
    expect(r.ok && (r.output as { dataGaps: string[] }).dataGaps).toEqual([]);
    expect(calls).toBe(4);
  });

  it('reports a persistent outage as a data gap, not a crash', async () => {
    const h = await harness({ ATTRIBUTION_FAILURE_RATE: '1' });
    const r = await runTool('get_attribution_data', { attributionCampaignIds: ['af_0000'], period: LAST_7 }, h.ctx, 5000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = r.output as { results: { status: string; error?: { code: string } }[]; dataGaps: string[] };
    expect(out.results[0]).toMatchObject({ status: 'error', error: { code: 'upstream_unavailable' } });
    expect(out.dataGaps[0]).toMatch(/unavailable after 3 attempts/);
  });
});
