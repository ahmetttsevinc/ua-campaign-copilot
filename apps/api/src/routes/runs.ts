import { API_KEY_HEADER, AgentEvent, CreateRunBody, CreateRunResponse, ListRunsQuery, ListRunsResponse, type ProviderName } from '@copilot/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentDeps } from '../agent/loop.js';
import { getRunRow } from '../agent/persistence.js';
import { isResumable, RunAlreadyActiveError, startRun } from '../agent/loop.js';
import { resumeRun, RunNotFoundError, RunNotResumableError } from '../agent/resume.js';
import { ProviderName as ProviderNameSchema } from '@copilot/shared';
import { listRuns, loadRun } from '../agent/persistence.js';
import { HttpError } from '../lib/errors.js';
import { ProviderNotConfiguredError } from '../llm/registry.js';

export class SimulatedCrashError extends Error {}

// Header, not body: keeps the key out of the persisted request shape and out of any body logging.
const UserKey = z.string().trim().min(10, 'API key looks too short').max(500).optional();
function userKeyFrom(headers: Record<string, unknown>): string | undefined {
  const raw = headers[API_KEY_HEADER];
  const parsed = UserKey.safeParse(typeof raw === 'string' && raw.trim() !== '' ? raw : undefined);
  if (!parsed.success) throw new HttpError(400, 'invalid_api_key', parsed.error.issues[0]?.message ?? 'Invalid API key');
  return parsed.data;
}

const RunParams = z.object({ id: z.uuid({ message: 'Run id must be a UUID' }) });

export async function runRoutes(app: FastifyInstance) {
  /** Builds per-run agent dependencies; the provider is chosen per request (or from config). */
  const agentDeps = (providerName: ProviderName, userKey?: string): AgentDeps => {
    const { config, db, fraud, events, providerFactory } = app.deps;
    let provider;
    try {
      provider = providerFactory(providerName, userKey);
    } catch (err) {
      if (err instanceof ProviderNotConfiguredError) {
        throw new HttpError(400, 'provider_not_configured', `Provider "${providerName}" is not configured: ${err.message}`);
      }
      throw err;
    }
    const killAfter = config.KILL_AFTER_STEP;
    return {
      db,
      provider,
      events,
      // Dev-only crash simulation for the resume demo. A resumed run continues past step N,
      // so it never trips the same switch twice.
      ...(killAfter !== undefined
        ? {
            afterStep: (step) => {
              if (step.stepNumber === killAfter) throw new SimulatedCrashError(`Simulated crash after step ${killAfter} (KILL_AFTER_STEP=${killAfter})`);
            },
          }
        : {}),
      toolCtx: { db, fraud, attributionBaseUrl: config.ATTRIBUTION_BASE_URL },
      budget: { maxSteps: config.AGENT_MAX_STEPS, maxTokens: config.AGENT_MAX_TOKENS, maxWallMs: config.AGENT_MAX_WALL_MS },
      toolTimeoutMs: config.TOOL_TIMEOUT_MS,
      retry: { maxAttempts: config.MAX_RETRIES, baseDelayMs: 500 },
    };
  };
  app.decorate('agentDeps', agentDeps);

  app.post('/runs', async (req, reply) => {
    const body = CreateRunBody.parse(req.body);
    const deps = agentDeps(body.provider ?? app.deps.config.LLM_PROVIDER, userKeyFrom(req.headers));
    const { runId, done } = await startRun(deps, body.question);
    // The loop runs in the background; clients follow it via SSE or polling.
    done.catch((err: unknown) => req.log.error({ err, runId }, 'agent run crashed outside the loop'));
    return reply.status(202).send(CreateRunResponse.parse({ runId }));
  });

  app.post('/runs/:id/resume', async (req, reply) => {
    const { id } = RunParams.parse(req.params);
    const run = await getRunRow(app.deps.db, id);
    if (!run) throw new HttpError(404, 'not_found', `Run ${id} not found`);
    // Resume with the provider that started the run: switching models mid-conversation would
    // make the trace and cost attribution misleading.
    const provider = ProviderNameSchema.safeParse(run.provider);
    if (!provider.success) throw new HttpError(409, 'not_resumable', `Run ${id} used unknown provider "${run.provider}"`);
    try {
      const { done } = await resumeRun(agentDeps(provider.data, userKeyFrom(req.headers)), id);
      done.catch((err: unknown) => req.log.error({ err, runId: id }, 'resumed run crashed outside the loop'));
    } catch (err) {
      if (err instanceof RunNotFoundError) throw new HttpError(404, 'not_found', err.message);
      if (err instanceof RunNotResumableError || err instanceof RunAlreadyActiveError) throw new HttpError(409, 'not_resumable', err.message);
      throw err;
    }
    return reply.status(202).send(CreateRunResponse.parse({ runId: id }));
  });

  app.get('/runs', async (req) => {
    const { limit } = ListRunsQuery.parse(req.query);
    return ListRunsResponse.parse({ runs: await listRuns(app.deps.db, limit) });
  });

  app.get('/runs/:id', async (req) => {
    const { id } = RunParams.parse(req.params);
    const run = await loadRun(app.deps.db, id, isResumable);
    if (!run) throw new HttpError(404, 'not_found', `Run ${id} not found`);
    return run;
  });

  /**
   * Server-Sent Events. On connect it replays persisted steps (so a late subscriber or a
   * reconnect sees the full trace), then forwards live events until the run ends.
   */
  app.get('/runs/:id/events', async (req, reply) => {
    const { id } = RunParams.parse(req.params);
    const { db, events } = app.deps;

    // Subscribe before reading the DB so no event can fall between snapshot and live stream.
    const buffered: AgentEvent[] = [];
    let forward: ((e: AgentEvent) => void) | null = null;
    const unsubscribe = events.subscribe(id, (e) => (forward ? forward(e) : buffered.push(e)));

    const run = await loadRun(db, id, isResumable);
    if (!run) {
      unsubscribe();
      throw new HttpError(404, 'not_found', `Run ${id} not found`);
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const sentSteps = new Set<number>();
    let closed = false;
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };
    req.raw.on('close', close);

    const send = (event: AgentEvent) => {
      if (closed) return;
      if (event.type === 'step_completed') {
        if (sentSteps.has(event.step.stepNumber)) return;
        sentSteps.add(event.step.stepNumber);
      }
      res.write(`data: ${JSON.stringify(AgentEvent.parse(event))}\n\n`);
      if (event.type === 'run_completed' || event.type === 'run_failed') close();
    };

    const { steps, ...summaryFields } = run;
    const { finalAnswer: _f, resumable: _r, ...summary } = summaryFields;
    for (const step of steps) send({ type: 'step_completed', runId: id, step, run: summary });
    if (run.status !== 'running') {
      send({ type: run.status === 'completed' ? 'run_completed' : 'run_failed', runId: id, run });
      return;
    }
    for (const e of buffered) send(e);
    forward = send;
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    agentDeps: (provider: ProviderName, userKey?: string) => AgentDeps;
  }
}
