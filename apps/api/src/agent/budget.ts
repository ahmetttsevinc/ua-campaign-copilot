export interface Budget {
  /** Maximum LLM calls per run (tool calls and repair prompts are not counted). */
  maxSteps: number;
  /** Maximum input + output tokens summed over all LLM calls in the run. */
  maxTokens: number;
  /** Maximum active wall time of one execution of the loop. */
  maxWallMs: number;
}

export interface BudgetUsage {
  llmCalls: number;
  totalTokens: number;
  elapsedMs: number;
}

export type BudgetVerdict = { status: 'max_steps_exceeded' | 'budget_exceeded'; reason: string } | null;

/** Checked before every LLM call, so a run can never start a call it is not allowed to make. */
export function checkBudget(budget: Budget, usage: BudgetUsage): BudgetVerdict {
  if (usage.llmCalls >= budget.maxSteps) {
    return { status: 'max_steps_exceeded', reason: `Reached the limit of ${budget.maxSteps} LLM steps without a final answer` };
  }
  if (usage.totalTokens >= budget.maxTokens) {
    return { status: 'budget_exceeded', reason: `Token budget exhausted (${usage.totalTokens} of ${budget.maxTokens})` };
  }
  if (usage.elapsedMs >= budget.maxWallMs) {
    return { status: 'budget_exceeded', reason: `Time budget exhausted (${usage.elapsedMs} ms of ${budget.maxWallMs} ms)` };
  }
  return null;
}
