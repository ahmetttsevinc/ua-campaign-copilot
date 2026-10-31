import type { Db } from '../db/client.js';
import { executeRun, isResumable, type AgentDeps } from './loop.js';
import { getRunRow, markRunning } from './persistence.js';

export class RunNotFoundError extends Error {}
export class RunNotResumableError extends Error {}

/**
 * Continues an interrupted run from its last persisted step. Message history is rebuilt from
 * agent_steps, completed tool calls are not executed again, and the run keeps its id, totals
 * and step numbering.
 */
export async function resumeRun(deps: AgentDeps, runId: string): Promise<{ done: Promise<void> }> {
  const run = await getRunRow(deps.db, runId);
  if (!run) throw new RunNotFoundError(`Run ${runId} not found`);
  if (!isResumable(run)) throw new RunNotResumableError(`Run ${runId} has status "${run.status}" and cannot be resumed`);
  await markRunning(deps.db, runId);
  return { done: executeRun(deps, runId) };
}

export async function getRunProvider(db: Db, runId: string): Promise<string | undefined> {
  return (await getRunRow(db, runId))?.provider;
}
