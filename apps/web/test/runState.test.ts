import { describe, expect, it } from 'vitest';
import { applyEvent } from '../src/lib/runState';
import { baseRun, step, view } from './fixtures';

const summary = (over = {}) => {
  const { steps: _s, finalAnswer: _f, resumable: _r, ...rest } = baseRun(over);
  return rest;
};

describe('applyEvent', () => {
  it('tracks started steps until they complete', () => {
    let v = applyEvent(view(), { type: 'step_started', runId: 'r1', stepNumber: 1, stepType: 'llm_call', toolName: null });
    expect(v.inFlight).toEqual([{ stepNumber: 1, stepType: 'llm_call', toolName: null }]);
    v = applyEvent(v, { type: 'step_completed', runId: 'r1', step: step(1), run: summary({ totalCostUsd: 0.001 }) });
    expect(v.inFlight).toEqual([]);
    expect(v.steps.map((s) => s.stepNumber)).toEqual([1]);
    expect(v.totalCostUsd).toBe(0.001);
  });

  it('keeps steps in step order when parallel tools finish out of order', () => {
    let v = view();
    for (const n of [3, 4, 2]) v = applyEvent(v, { type: 'step_completed', runId: 'r1', step: step(n), run: summary() });
    expect(v.steps.map((s) => s.stepNumber)).toEqual([2, 3, 4]);
  });

  it('ignores replayed events (SSE reconnects replay the whole trace)', () => {
    let v = applyEvent(view(), { type: 'step_completed', runId: 'r1', step: step(1), run: summary() });
    v = applyEvent(v, { type: 'step_completed', runId: 'r1', step: step(1), run: summary() });
    v = applyEvent(v, { type: 'step_started', runId: 'r1', stepNumber: 1, stepType: 'tool_call', toolName: 'x' });
    expect(v.steps).toHaveLength(1);
    expect(v.inFlight).toEqual([]);
  });

  it('replaces the whole view with the final run on completion', () => {
    const v = applyEvent(
      { ...view(), inFlight: [{ stepNumber: 9, stepType: 'llm_call', toolName: null }] },
      { type: 'run_completed', runId: 'r1', run: baseRun({ status: 'completed', steps: [step(1)] }) },
    );
    expect(v.status).toBe('completed');
    expect(v.inFlight).toEqual([]);
    expect(v.steps).toHaveLength(1);
  });
});
