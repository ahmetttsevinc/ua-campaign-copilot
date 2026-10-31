import type { AgentRun } from '@copilot/shared';
import type { EvalCase, Score } from '../types.js';

/** Did the agent use the sources the question needs, efficiently and without inventing tools? */
export function scoreToolUsage(run: AgentRun, c: EvalCase): Score {
  const details: string[] = [];
  const toolSteps = run.steps.filter((s) => s.type === 'tool_call');
  const called = new Set(toolSteps.map((s) => s.toolName));
  const llmCalls = run.steps.filter((s) => s.type === 'llm_call').length;

  for (const t of c.tools.required) if (!called.has(t)) details.push(`did not call ${t}`);
  if (llmCalls > c.tools.maxLlmSteps) details.push(`${llmCalls} LLM steps, limit for this question is ${c.tools.maxLlmSteps}`);

  const errorCode = (s: (typeof toolSteps)[number]) => ((s.output as { error?: { code?: string } } | null)?.error?.code ?? null);
  const unknown = toolSteps.filter((s) => errorCode(s) === 'unknown_tool');
  if (unknown.length) details.push(`called nonexistent tool(s): ${unknown.map((s) => s.toolName).join(', ')}`);

  const fails = details.length;
  const invalid = toolSteps.filter((s) => errorCode(s) === 'invalid_input').length;
  // Invalid inputs that the model then fixed are recoverable; reported, not failed.
  if (invalid) details.push(`${invalid} tool call(s) with invalid input (recovered)`);
  return { status: fails ? 'fail' : 'pass', details: [`${llmCalls} LLM steps, tools: ${[...called].join(', ') || 'none'}`, ...details] };
}
