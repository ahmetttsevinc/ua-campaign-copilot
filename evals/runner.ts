// Eval runner: pnpm eval --provider anthropic|nebius|all --cases all|S1,s2-cpi-up [--judge] [--concurrency 3]
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentRun, ProviderName } from '@copilot/shared';
import { buildApp, defaultDeps } from '../apps/api/src/app.js';
import { EventBus } from '../apps/api/src/agent/events.js';
import { isResumable, startRun } from '../apps/api/src/agent/loop.js';
import { loadRun } from '../apps/api/src/agent/persistence.js';
import { PROMPT_VERSION } from '../apps/api/src/agent/prompts.js';
import { parseConfig } from '../apps/api/src/config.js';
import { createDb } from '../apps/api/src/db/client.js';
import { prepareDatabase, withDatabase } from '../apps/api/src/db/prepare.js';
import { mapLimit } from '../apps/api/src/lib/concurrency.js';
import { AnthropicProvider } from '../apps/api/src/llm/anthropic.js';
import { NebiusProvider } from '../apps/api/src/llm/openaiCompatible.js';
import type { LLMProvider } from '../apps/api/src/llm/provider.js';
import { createProvider } from '../apps/api/src/llm/registry.js';
import { createFraudStore } from '../apps/api/src/sources/fraudCsv/loader.js';
import { CASES } from './cases/index.js';
import { createTruth } from './groundTruth.js';
import { type CaseResult, printConsole, summarize, toMarkdown } from './report.js';
import { scoreExpectations } from './scorers/expectations.js';
import { scoreJudge } from './scorers/judge.js';
import { scoreNumeric } from './scorers/numeric.js';
import { scoreToolUsage } from './scorers/toolUsage.js';
import type { EvalCase, ScorerName, Score } from './types.js';

function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    provider: get('provider') ?? 'anthropic',
    cases: get('cases') ?? 'all',
    judge: argv.includes('--judge'),
    concurrency: Number(get('concurrency') ?? 3),
  };
}

function selectCases(filter: string): EvalCase[] {
  if (filter === 'all') return CASES;
  const wanted = filter.split(',').map((s) => s.trim());
  // Accept scenario tags (S1, ADV) or case ids.
  const picked = CASES.filter((c) => wanted.includes(c.id) || wanted.includes(c.scenario));
  if (picked.length === 0) throw new Error(`No cases match "${filter}". Ids: ${CASES.map((c) => c.id).join(', ')}`);
  return picked;
}

const args = parseArgs(process.argv.slice(2));
const config = parseConfig({ ...process.env, LLM_PROVIDER: 'fake' });
const providers: ProviderName[] = args.provider === 'all' ? ['anthropic', 'nebius'] : [args.provider as ProviderName];
const usable = providers.filter((p) => (p === 'anthropic' ? config.ANTHROPIC_API_KEY : p === 'nebius' ? config.NEBIUS_API_KEY : true));
for (const p of providers) if (!usable.includes(p)) console.warn(`Skipping ${p}: no API key configured`);
if (usable.length === 0) throw new Error('No configured provider to evaluate');
const cases = selectCases(args.cases);

// Isolated, freshly seeded database and data files: evals never touch dev data or history.
const evalDbUrl = withDatabase(config.DATABASE_URL, 'copilot_eval');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'ua-copilot-eval-'));
console.log(`Preparing copilot_eval database and data files in ${dataDir}…`);
await prepareDatabase(evalDbUrl, dataDir);
const { db, sql } = createDb(evalDbUrl);
const fraud = createFraudStore(dataDir);

/** Starts an attribution mock (the real Fastify app) with the given fault rate. */
async function startMock(failureRate: number) {
  const app = buildApp(
    defaultDeps({
      config: { ...config, DATA_DIR: dataDir, ATTRIBUTION_FAILURE_RATE: failureRate, ATTRIBUTION_LATENCY_MS_MIN: 50, ATTRIBUTION_LATENCY_MS_MAX: 200 },
      db,
      fraud,
    }),
  );
  await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, url: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/mock/attribution` };
}
// "up" has no injected 503s so results reflect the model, not luck; the outage case uses "down".
const mocks = { up: await startMock(0), down: await startMock(1) };
const truth = await createTruth(sql, dataDir);

let judge: LLMProvider | null = null;
if (args.judge) {
  judge =
    config.JUDGE_PROVIDER === 'anthropic'
      ? new AnthropicProvider(config.JUDGE_MODEL, config.ANTHROPIC_API_KEY ?? '', 'low', config.LLM_TIMEOUT_MS)
      : new NebiusProvider(config.JUDGE_MODEL, config.NEBIUS_API_KEY ?? '', config.NEBIUS_BASE_URL, config.LLM_TIMEOUT_MS);
}

async function runCase(c: EvalCase, providerName: ProviderName): Promise<CaseResult> {
  const provider = createProvider(providerName, config);
  const label = `${c.id} [${providerName}]`;
  try {
    const { runId, done } = await startRun(
      {
        db,
        provider,
        events: new EventBus(),
        toolCtx: { db, fraud, attributionBaseUrl: mocks[c.attribution].url },
        budget: { maxSteps: config.AGENT_MAX_STEPS, maxTokens: config.AGENT_MAX_TOKENS, maxWallMs: config.AGENT_MAX_WALL_MS },
        toolTimeoutMs: config.TOOL_TIMEOUT_MS,
        retry: { maxAttempts: config.MAX_RETRIES, baseDelayMs: 500 },
      },
      c.question,
    );
    await done;
    const run = (await loadRun(db, runId, isResumable)) as AgentRun;
    const scores: Partial<Record<ScorerName, Score>> = {
      expectations: scoreExpectations(run, c),
      numeric: await scoreNumeric(run, c, truth),
      toolUsage: scoreToolUsage(run, c),
    };
    let judgeScore: number | undefined;
    if (judge) {
      const j = await scoreJudge(run, c, judge).catch((err: unknown): Score => ({ status: 'fail', details: [`judge error: ${String(err)}`] }));
      scores.judge = j;
      if ('score' in j && typeof j.score === 'number') judgeScore = j.score;
    }
    const passed = Object.values(scores).every((s) => s.status !== 'fail');
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}  ${run.status}  $${run.totalCostUsd.toFixed(4)}  ${(run.totalLatencyMs / 1000).toFixed(1)}s`);
    return {
      caseId: c.id,
      scenario: c.scenario,
      question: c.question,
      provider: providerName,
      model: run.model,
      promptVersion: run.promptVersion,
      runId,
      status: run.status,
      passed,
      scores,
      ...(judgeScore !== undefined ? { judgeScore } : {}),
      llmSteps: run.steps.filter((s) => s.type === 'llm_call').length,
      totalSteps: run.steps.length,
      tokens: run.totalInputTokens + run.totalOutputTokens,
      costUsd: run.totalCostUsd,
      latencyMs: run.totalLatencyMs,
      ...(run.error ? { error: run.error.slice(0, 300) } : {}),
    };
  } catch (err) {
    console.log(`FAIL  ${label}  harness error: ${String(err)}`);
    return {
      caseId: c.id, scenario: c.scenario, question: c.question, provider: providerName, model: provider.model, promptVersion: PROMPT_VERSION,
      runId: '', status: 'harness_error', passed: false, scores: {}, llmSteps: 0, totalSteps: 0, tokens: 0, costUsd: 0, latencyMs: 0, error: String(err),
    };
  }
}

const startedAt = new Date();
const jobs = usable.flatMap((p) => cases.map((c) => ({ c, p })));
console.log(`Running ${jobs.length} runs (${cases.length} cases x ${usable.join(', ')}), concurrency ${args.concurrency}, prompt ${PROMPT_VERSION}\n`);
const results = await mapLimit(jobs, args.concurrency, ({ c, p }) => runCase(c, p));

const summaries = summarize(results);
console.log('');
printConsole(results, summaries);

const reportsDir = fileURLToPath(new URL('./reports', import.meta.url));
await mkdir(reportsDir, { recursive: true });
const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
const command = `pnpm eval ${process.argv.slice(2).join(' ')}`.trim();
const meta = { startedAt: startedAt.toISOString(), promptVersion: PROMPT_VERSION, judge: args.judge, command };
await writeFile(path.join(reportsDir, `${stamp}.json`), `${JSON.stringify({ meta, summaries, results }, null, 2)}\n`);
await writeFile(path.join(reportsDir, `${stamp}.md`), toMarkdown(results, summaries, meta));
console.log(`\nReports: evals/reports/${stamp}.md and .json`);

await Promise.all([mocks.up.app.close(), mocks.down.app.close()]);
await sql.end();
