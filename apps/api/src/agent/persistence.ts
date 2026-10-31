import { type AgentRun, type AgentRunSummary, type AgentStep, FinalAnswer, type RunStatus, type StepType } from '@copilot/shared';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agentRuns, agentSteps } from '../db/schema.js';

type RunRow = typeof agentRuns.$inferSelect;
type StepRow = typeof agentSteps.$inferSelect;

export function toRunSummary(r: RunRow): AgentRunSummary {
  return {
    id: r.id,
    question: r.question,
    status: r.status,
    provider: r.provider,
    model: r.model,
    promptVersion: r.promptVersion,
    error: r.error,
    totalInputTokens: r.totalInputTokens,
    totalOutputTokens: r.totalOutputTokens,
    totalCostUsd: Number(r.totalCostUsd),
    totalLatencyMs: r.totalLatencyMs,
    retries: r.retries,
    repairs: r.repairs,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

export function toStep(s: StepRow): AgentStep {
  return {
    id: s.id,
    runId: s.runId,
    stepNumber: s.stepNumber,
    type: s.type,
    toolName: s.toolName,
    input: s.input,
    output: s.output,
    isError: s.isError,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    costUsd: Number(s.costUsd),
    latencyMs: s.latencyMs,
    createdAt: s.createdAt.toISOString(),
  };
}

export async function createRun(
  db: Db,
  r: { question: string; provider: string; model: string; promptVersion: string },
): Promise<RunRow> {
  const [row] = await db.insert(agentRuns).values({ ...r, status: 'running' }).returning();
  if (!row) throw new Error('Failed to create run');
  return row;
}

export async function getRunRow(db: Db, runId: string): Promise<RunRow | undefined> {
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  return row;
}

export async function getStepRows(db: Db, runId: string): Promise<StepRow[]> {
  return db.select().from(agentSteps).where(eq(agentSteps.runId, runId)).orderBy(asc(agentSteps.stepNumber));
}

export interface NewStep {
  runId: string;
  stepNumber: number;
  type: StepType;
  toolName?: string | null;
  input: unknown;
  output: unknown;
  isError?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs: number;
}

/**
 * Inserts a step and bumps the run's running totals in one transaction, so totals never
 * disagree with the steps that produced them, even after a crash.
 */
export async function appendStep(db: Db, step: NewStep, extra: { retries?: number } = {}): Promise<StepRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(agentSteps)
      .values({
        runId: step.runId,
        stepNumber: step.stepNumber,
        type: step.type,
        toolName: step.toolName ?? null,
        input: step.input,
        output: step.output,
        isError: step.isError ?? false,
        inputTokens: step.inputTokens ?? 0,
        outputTokens: step.outputTokens ?? 0,
        costUsd: (step.costUsd ?? 0).toFixed(6),
        latencyMs: step.latencyMs,
      })
      .returning();
    if (!row) throw new Error('Failed to insert step');
    await tx
      .update(agentRuns)
      .set({
        totalInputTokens: sql`${agentRuns.totalInputTokens} + ${step.inputTokens ?? 0}`,
        totalOutputTokens: sql`${agentRuns.totalOutputTokens} + ${step.outputTokens ?? 0}`,
        totalCostUsd: sql`${agentRuns.totalCostUsd} + ${(step.costUsd ?? 0).toFixed(6)}::numeric`,
        retries: sql`${agentRuns.retries} + ${extra.retries ?? 0}`,
        repairs: sql`${agentRuns.repairs} + ${step.type === 'repair' ? 1 : 0}`,
      })
      .where(eq(agentRuns.id, step.runId));
    return row;
  });
}

export async function addRetries(db: Db, runId: string, retries: number): Promise<void> {
  if (retries > 0) await db.update(agentRuns).set({ retries: sql`${agentRuns.retries} + ${retries}` }).where(eq(agentRuns.id, runId));
}

export async function markRunning(db: Db, runId: string): Promise<void> {
  await db.update(agentRuns).set({ status: 'running', error: null, completedAt: null }).where(eq(agentRuns.id, runId));
}

export async function finishRun(
  db: Db,
  runId: string,
  f: { status: Exclude<RunStatus, 'running'>; finalAnswer?: FinalAnswer; error?: string; activeMs: number },
): Promise<void> {
  await db
    .update(agentRuns)
    .set({
      status: f.status,
      finalAnswer: f.finalAnswer ?? null,
      error: f.error ?? null,
      completedAt: new Date(),
      // Active time across executions; a resumed run does not count the downtime in between.
      totalLatencyMs: sql`${agentRuns.totalLatencyMs} + ${Math.round(f.activeMs)}`,
    })
    .where(eq(agentRuns.id, runId));
}

/**
 * Called once at server start. A run still marked "running" belongs to a process that died
 * mid-run (single API process assumed), so it becomes a failed, resumable run instead of
 * spinning forever in the UI.
 */
export async function failOrphanedRuns(db: Db): Promise<number> {
  const rows = await db
    .update(agentRuns)
    .set({ status: 'failed', error: 'Interrupted: the server stopped while this run was in progress. Resume to continue.', completedAt: new Date() })
    .where(eq(agentRuns.status, 'running'))
    .returning({ id: agentRuns.id });
  return rows.length;
}

export async function listRuns(db: Db, limit: number): Promise<AgentRunSummary[]> {
  const rows = await db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt)).limit(limit);
  return rows.map(toRunSummary);
}

export async function loadRun(db: Db, runId: string, isResumable: (r: RunRow) => boolean): Promise<AgentRun | undefined> {
  const row = await getRunRow(db, runId);
  if (!row) return undefined;
  const steps = await getStepRows(db, runId);
  const answer = row.finalAnswer === null ? null : FinalAnswer.safeParse(row.finalAnswer);
  return {
    ...toRunSummary(row),
    finalAnswer: answer?.success ? answer.data : null,
    steps: steps.map(toStep),
    resumable: isResumable(row),
  };
}

export type { RunRow, StepRow };
