import { describe, expect, it } from 'vitest';
import { changeSentiment, formatChange, formatMetric, stepTitle } from '../src/lib/format';
import { llmStep, step } from './fixtures';

describe('formatMetric', () => {
  it('formats by metric kind', () => {
    expect(formatMetric('roas', 0.4738)).toBe('0.47');
    expect(formatMetric('cpi', 8.93)).toBe('$8.93');
    expect(formatMetric('installs', 7833)).toBe('7,833');
    expect(formatMetric('d7Retention', 0.0482)).toBe('4.8%');
    expect(formatMetric('installDiscrepancyPct', -40)).toBe('-40.0%');
    expect(formatMetric('roas', null)).toBe('n/a');
  });

  it('formats changes with a real minus sign', () => {
    expect(formatChange(-49.2)).toBe('−49.2%');
    expect(formatChange(85.7)).toBe('+85.7%');
    expect(formatChange(null)).toBe('n/a');
  });
});

describe('changeSentiment', () => {
  it('colours by meaning, not by sign', () => {
    expect(changeSentiment('roas', -49.2)).toBe('bad');
    expect(changeSentiment('roas', 20)).toBe('good');
    expect(changeSentiment('cpi', 85.7)).toBe('bad');
    expect(changeSentiment('cpi', -20)).toBe('good');
    expect(changeSentiment('d7Retention', -50.6)).toBe('bad');
  });

  it('stays neutral for small moves, neutral metrics and unknowns', () => {
    expect(changeSentiment('roas', -3)).toBe('neutral');
    expect(changeSentiment('spendUsd', 105)).toBe('neutral');
    expect(changeSentiment('mystery', -80)).toBe('neutral');
    expect(changeSentiment('installDiscrepancyPct', -40)).toBe('bad');
  });
});

describe('stepTitle', () => {
  it('describes steps in plain language', () => {
    expect(stepTitle(step(2, { toolName: 'get_fraud_signals' }))).toBe('Checked fraud signals');
    expect(stepTitle(llmStep(1, { stopReason: 'tool_use', toolCalls: [{ name: 'compare_campaign_periods' }, { name: 'resolve_campaign_id' }] }))).toBe(
      'Model chose: compared two periods, matched campaign ids',
    );
    expect(stepTitle(llmStep(5, { stopReason: 'end_turn', toolCalls: [] }))).toBe('Model wrote the answer');
    expect(stepTitle(step(4, { type: 'repair', toolName: null }))).toBe('Asked the model to fix its answer format');
  });
});
