import type { FinalAnswer } from '@copilot/shared';
import { describe, expect, it } from 'vitest';
import { checkBudget } from '../src/agent/budget.js';
import { applyGroundingCheck, isGrounded } from '../src/agent/grounding.js';
import { SYSTEM_PROMPT, PROMPT_VERSION } from '../src/agent/prompts.js';
import { extractJson, parseFinalAnswer, repairMessage } from '../src/agent/repair.js';

const answer: FinalAnswer = {
  summary: 'ROAS dropped.',
  findings: [
    { campaignId: 'cmp_007', campaignName: 'x', metric: 'roas', before: 0.9318, after: 0.4738, changePct: -49.2, likelyCause: 'fraud', evidence: ['step_2'] },
  ],
  caveats: [],
  confidence: 'high',
};

describe('extractJson', () => {
  it('reads plain JSON, fenced JSON and JSON surrounded by prose', () => {
    expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJson('Here you go:\n```json\n{"a":2}\n```\nThanks')).toEqual({ ok: true, value: { a: 2 } });
    expect(extractJson('Answer: {"a":3} hope that helps')).toEqual({ ok: true, value: { a: 3 } });
  });

  it('reports missing or broken JSON', () => {
    expect(extractJson('no json here')).toMatchObject({ ok: false, error: expect.stringMatching(/No JSON/) });
    expect(extractJson('{"a": }')).toMatchObject({ ok: false, error: expect.stringMatching(/invalid JSON/) });
  });
});

describe('parseFinalAnswer', () => {
  it('accepts a valid answer', () => {
    expect(parseFinalAnswer(JSON.stringify(answer))).toEqual({ ok: true, answer });
  });

  it('lists schema violations with paths the model can fix', () => {
    const r = parseFinalAnswer(JSON.stringify({ ...answer, confidence: 'certain', findings: [{ campaignId: 'cmp_007' }] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.startsWith('confidence:'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('findings.0.metric:'))).toBe(true);
  });

  it('rejects empty replies', () => {
    expect(parseFinalAnswer('  ')).toMatchObject({ ok: false });
    expect(parseFinalAnswer(undefined)).toMatchObject({ ok: false });
  });

  it('builds a repair prompt listing the errors', () => {
    const m = repairMessage(['confidence: Invalid option'], true);
    expect(m).toMatch(/cut off/);
    expect(m).toMatch(/- confidence: Invalid option/);
    expect(m).toMatch(/ONLY the corrected JSON/);
  });
});

describe('grounding check', () => {
  it('accepts exact values, roundings and percent forms of tool numbers', () => {
    const pool = [0.9318, 13360.63, 7611];
    expect(isGrounded(0.9318, pool)).toBe(true);
    expect(isGrounded(0.93, pool)).toBe(true);
    expect(isGrounded(0.932, pool)).toBe(true);
    expect(isGrounded(93.18, pool)).toBe(true);
    expect(isGrounded(93.2, pool)).toBe(true);
    expect(isGrounded(13361, pool)).toBe(true);
    expect(isGrounded(7611, pool)).toBe(true);
  });

  it('rejects invented numbers and loose integer roundings of ratios', () => {
    const pool = [0.9318];
    expect(isGrounded(0.95, pool)).toBe(false);
    expect(isGrounded(1, pool)).toBe(false);
  });

  it('leaves grounded answers untouched', () => {
    const r = applyGroundingCheck(answer, [{ rows: [{ roas: 0.9318 }, { roas: 0.4738 }] }]);
    expect(r.ungrounded).toEqual([]);
    expect(r.answer).toBe(answer);
  });

  it('downgrades confidence and adds a caveat when numbers are not traceable', () => {
    const r = applyGroundingCheck(answer, [{ roas: 0.9318 }]);
    expect(r.ungrounded).toEqual([{ campaignId: 'cmp_007', field: 'after', value: 0.4738 }]);
    expect(r.answer.confidence).toBe('low');
    expect(r.answer.caveats.at(-1)).toMatch(/cmp_007 after=0.4738/);
  });
});

describe('checkBudget', () => {
  const budget = { maxSteps: 10, maxTokens: 50_000, maxWallMs: 90_000 };
  it('passes within limits and names the exceeded limit otherwise', () => {
    expect(checkBudget(budget, { llmCalls: 9, totalTokens: 49_999, elapsedMs: 89_999 })).toBeNull();
    expect(checkBudget(budget, { llmCalls: 10, totalTokens: 0, elapsedMs: 0 })?.status).toBe('max_steps_exceeded');
    expect(checkBudget(budget, { llmCalls: 1, totalTokens: 50_000, elapsedMs: 0 })).toMatchObject({ status: 'budget_exceeded', reason: expect.stringMatching(/Token/) });
    expect(checkBudget(budget, { llmCalls: 1, totalTokens: 0, elapsedMs: 90_000 })).toMatchObject({ status: 'budget_exceeded', reason: expect.stringMatching(/Time/) });
  });
});

describe('system prompt', () => {
  it('is versioned, static and states the data date and default windows', () => {
    expect(PROMPT_VERSION).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(SYSTEM_PROMPT).toContain('Today is 2026-11-02');
    expect(SYSTEM_PROMPT).toContain('2026-10-26 to 2026-11-01');
    expect(SYSTEM_PROMPT).toContain('2026-10-19 to 2026-10-25');
  });
});
