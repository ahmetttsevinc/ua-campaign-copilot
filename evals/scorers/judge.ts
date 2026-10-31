import type { AgentRun } from '@copilot/shared';
import { z } from 'zod';
import { extractJson } from '../../apps/api/src/agent/repair.js';
import type { LLMProvider } from '../../apps/api/src/llm/provider.js';
import type { EvalCase, Score } from '../types.js';

const JudgeVerdict = z.object({
  score: z.number().int().min(1).max(5),
  rationale: z.string().min(1),
});

const RUBRIC = `You grade answers from an analytics assistant for a user acquisition manager.
Score how well the answer EXPLAINS THE CAUSE, compared with the reference, from 1 to 5:
5 = names the reference cause correctly, with the key supporting signals, in plain language, no invented claims
4 = correct cause, minor omissions or slightly unclear wording
3 = partly correct cause, or correct but vague / missing the key signal
2 = mostly wrong or speculative cause, or flags problems that are not real
1 = wrong cause, invented data, or no explanation
Judge only the explanation; numbers are checked elsewhere.
Submit your grade by calling the submit_grade tool exactly once.`;

// A tool call gives structured arguments from the provider; free-text JSON broke on quotes in rationales.
const SUBMIT_GRADE = {
  name: 'submit_grade',
  description: 'Submit the grade for the answer.',
  inputSchema: (({ $schema: _s, ...rest }) => rest)(z.toJSONSchema(JudgeVerdict) as Record<string, unknown>),
};

/** Optional LLM-as-judge (behind --judge). Its own output is validated like any other LLM output. */
export async function scoreJudge(run: AgentRun, c: EvalCase, judge: LLMProvider): Promise<Score & { score?: number }> {
  if (!run.finalAnswer) return { status: 'skip', details: ['no answer to judge'] };
  const res = await judge.chat({
    system: RUBRIC,
    tools: [SUBMIT_GRADE],
    // Generous: on Claude, adaptive thinking counts toward max_tokens and truncated JSON is useless.
    maxTokens: 8000,
    messages: [
      {
        role: 'user',
        content: `Question: ${c.question}\n\nReference (ground truth): ${c.expected.description}\n\nAnswer to grade:\n${JSON.stringify(run.finalAnswer, null, 2)}`,
      },
    ],
  });
  // Prefer the tool call; fall back to JSON in text for providers that answer in prose.
  const call = res.toolCalls.find((t) => t.name === SUBMIT_GRADE.name);
  const json = call ? { ok: true as const, value: call.input } : extractJson(res.text ?? '');
  const verdict = json.ok ? JudgeVerdict.safeParse(json.value) : null;
  if (!verdict?.success) {
    return { status: 'fail', details: [`judge output invalid (${res.stopReason}): ${JSON.stringify(call?.input ?? res.text ?? '').slice(0, 300)}`] };
  }
  return { status: verdict.data.score >= 3 ? 'pass' : 'fail', score: verdict.data.score, details: [`${verdict.data.score}/5: ${verdict.data.rationale}`] };
}
