# PRD: UA Campaign Copilot

**Status:** Implemented
**Audience of this document:** the implementation agent (Claude Code) and maintainers of the project

---

## 0. Instructions for Claude Code

Read this whole document before writing code. Then follow these rules for the entire project:

1. **Work milestone by milestone** (Section 12). Do not start a milestone until the previous one passes its acceptance criteria. After each milestone, stop, summarise what was built, list how to verify it, and wait for review before continuing.
2. **No agent frameworks.** Do not use LangChain, LlamaIndex, Vercel AI SDK agents, CrewAI, Mastra or similar. The agent loop is written by hand (Section 7). This is a hard requirement: every line of the agent must stay readable and explainable to anyone maintaining it. Official provider SDKs (`@anthropic-ai/sdk`, `openai`) are allowed.
3. **TypeScript strict mode everywhere.** No `any` unless justified in a comment.
4. **Every LLM output that the system acts on is validated with zod.** No exceptions.
5. **The LLM never computes numbers.** Aggregations, ratios and comparisons happen in SQL or TypeScript inside tools. The LLM decides which tool to call and explains results.
6. **Write tests alongside code** (Section 11). A milestone is not done if its tests fail.
7. **Keep it small and readable.** Prefer clear code over clever code. Prefer one obvious file over an abstraction with a single implementation, except for the `LLMProvider` interface, which is intentional.
8. **Explain non-obvious decisions in short code comments** that answer "why", not "what".
9. If something in this PRD is ambiguous or conflicts with reality (an API changed, a package is deprecated), stop and ask instead of guessing.

---

## 1. Background and purpose

Companies that run a rewards/offerwall platform acquire users for advertisers. Their business teams (marketing, user acquisition, operations) need answers that span several systems: internal spend and revenue data, an external attribution provider, and fraud vendors. Today those answers are assembled by hand in spreadsheets.

UA Campaign Copilot is an internal AI tool for these teams. Its requirements:

- Full stack: front end, back end, database
- An agentic system that integrates LLM APIs
- **Durable AI workflows that adapt as the LLM landscape evolves, not brittle prompt chains**
- Making sense of fragmented data across multiple systems
- Answers that non-technical stakeholders can read and trust

The project aims to:

1. Deliver a **working full stack application** (front end, back end, database) that a UA manager can use directly.
2. Demonstrate a **durable agent architecture**: provider abstraction, schema validation, step persistence, resumability, evals.
3. Apply it to a **concrete domain** (user acquisition analytics) with realistic data problems.
4. Measure quality with a **real eval harness** instead of manual spot checks.

---

## 2. Product summary

**UA Campaign Copilot** is an internal web tool for a user acquisition (UA) manager. The manager asks questions in natural language, for example:

> "Which 3 campaigns had the biggest ROAS drop last week compared to the week before, and why?"

An AI agent answers by calling tools that query **three fragmented data sources**:

1. **Postgres**: internal campaign spend and revenue data
2. **Mock attribution API**: install and event data from an external attribution provider (simulates AppsFlyer/Adjust), with slightly different campaign identifiers
3. **Fraud signals CSV**: a daily export from a fraud vendor

The agent returns a written answer, a supporting data table, and a visible trace of every step it took (tools called, inputs, outputs, tokens, latency, cost).

---

## 3. Target user and stakeholder story

**Primary persona: Lena, UA Manager**

- Manages 20+ campaigns across advertisers and countries
- Lives in dashboards and spreadsheets, not SQL
- Every Monday she spends ~2 hours explaining performance changes to her lead
- Pain: data is split across internal DB, attribution tool and fraud vendor; joining them manually is slow and error prone

**Job to be done:** "When performance changes, I want to know what changed and the likely reason, with numbers I can trust and verify, in under a minute."

**Trust requirement:** Lena must be able to see where every number came from. This is why the step trace is a first-class UI feature, not a debug panel.

---

## 4. Goals and non-goals

### Goals

- G1: Answer the core question set (Section 10.2) correctly, with numbers that match ground truth.
- G2: Switch LLM provider (Anthropic Claude vs Nebius Token Factory open model) via config only, with no code changes in agent logic.
- G3: Survive transient failures: provider errors, invalid model output, tool exceptions.
- G4: Resume an interrupted agent run from the last completed step.
- G5: Run an eval suite from the CLI that reports pass rate, cost and latency per provider.
- G6: Clean, explainable codebase that a new engineer can follow end to end.

### Non-goals

- Authentication, multi-tenancy, role management
- Production deployment, cloud infra, Kubernetes
- Real integrations with AppsFlyer, Adjust or any real fraud vendor
- RAG over documents, vector databases, fine-tuning
- Mobile layout polish
- Free-form SQL generation by the LLM (deliberately excluded; see Section 7.4)

---

## 5. Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Monorepo | pnpm workspaces | Simple, fast, shared types |
| Language | TypeScript (strict) | One typed language across API, agent and UI |
| Back end | Node.js 20+, Fastify | Lightweight, typed, good SSE support |
| ORM / SQL | Drizzle ORM + `postgres` driver | SQL-first, explicit, easy to explain |
| Database | Postgres 16 in Docker Compose | Realistic, matches "databases" requirement |
| Validation | zod | Shared schemas between API, agent and UI |
| LLM providers | `@anthropic-ai/sdk`, `openai` (for Nebius Token Factory, OpenAI-compatible) | Two real providers prove abstraction |
| Front end | React 18 + Vite + TypeScript | Standard, fast to build |
| Data fetching | TanStack Query | Clean server-state handling |
| Styling | Tailwind CSS | Fast, no design system needed |
| Unit/integration tests | Vitest | Fast, TS native |
| E2E tests | Playwright | Reliable browser automation with good debugging tools |
| Logging | pino (built into Fastify) | Structured logs |

---

## 6. Repository structure

```
ua-campaign-copilot/
  PRD.md
  CLAUDE.md                      # short conventions file for Claude Code
  README.md
  docker-compose.yml             # postgres
  .env.example
  package.json                   # workspace root scripts
  pnpm-workspace.yaml
  packages/
    shared/                      # zod schemas + types shared by api and web
      src/
        schemas/
          agent.ts               # AgentRun, AgentStep, AgentEvent
          tools.ts               # tool input/output schemas
          answer.ts              # FinalAnswer schema
  apps/
    api/
      src/
        server.ts                # Fastify bootstrap
        config.ts                # env parsing with zod
        db/
          schema.ts              # Drizzle tables
          client.ts
          migrations/
          seed/
            seed.ts              # deterministic seed with injected anomalies
            scenarios.ts         # documented anomalies = eval ground truth
        llm/
          provider.ts            # LLMProvider interface + types
          anthropic.ts           # AnthropicProvider
          openaiCompatible.ts    # NebiusProvider (OpenAI-compatible)
          registry.ts            # pick provider from config
          pricing.ts             # cost per token per model
          retry.ts               # backoff + error classification
        agent/
          loop.ts                # the hand-written agent loop
          prompts.ts             # system prompt, versioned
          repair.ts              # schema repair loop
          persistence.ts         # write/read agent_runs and agent_steps
          resume.ts              # resume interrupted run
          budget.ts              # step, token and time limits
        tools/
          index.ts               # tool registry
          getCampaignMetrics.ts
          compareCampaignPeriods.ts
          getAttributionData.ts
          getFraudSignals.ts
          listCampaigns.ts
          resolveCampaignId.ts
        sources/
          attributionMock/       # mock external API (separate Fastify plugin)
          fraudCsv/              # CSV loader
        routes/
          runs.ts                # POST /runs, GET /runs/:id, GET /runs/:id/events (SSE)
          campaigns.ts
          health.ts
      test/
    web/
      src/
        main.tsx
        App.tsx
        api/                     # typed client
        components/
          ChatInput.tsx
          AnswerCard.tsx
          DataTable.tsx
          StepTrace.tsx
          RunHistory.tsx
          ProviderBadge.tsx
      e2e/                       # Playwright
  evals/
    cases/                       # one JSON/TS file per eval case
    runner.ts                    # CLI eval runner
    scorers/
      numeric.ts
      toolUsage.ts
      judge.ts                   # optional LLM-as-judge
    reports/                     # generated, gitignored except .gitkeep
```

---

## 7. Agent architecture (core of the project)

### 7.1 Principle

**Workflow where possible, agent where necessary.** Deterministic work (data fetching, joins, aggregation, ID resolution) lives in tools written in TypeScript. The LLM only does what code cannot do well: interpret the question, choose tools and parameters, and explain results in plain language.

### 7.2 LLMProvider interface

```ts
// apps/api/src/llm/provider.ts
export interface LLMProvider {
  readonly name: 'anthropic' | 'nebius';
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export interface ChatRequest {
  system: string;
  messages: NormalizedMessage[];   // provider-neutral format
  tools: ToolDefinition[];         // name, description, JSON schema (from zod)
  maxTokens: number;
  temperature?: number;
}

export interface ChatResponse {
  stopReason: 'tool_use' | 'end_turn' | 'max_tokens' | 'error';
  text?: string;
  toolCalls: { id: string; name: string; input: unknown }[];
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  raw?: unknown;                   // stored for debugging, never used by logic
}
```

Requirements:

- `NormalizedMessage` is the single internal message format. Each provider adapter translates to and from its native format. Agent code never touches provider-native types.
- Tool JSON schemas are generated from zod schemas (use `zod-to-json-schema`). One source of truth.
- Provider and model are selected by env vars only (Section 13).
- **Anthropic adapter:** uses the Messages API with native tool use.
- **Nebius adapter:** uses the `openai` SDK with `baseURL` pointed at Nebius Token Factory and native function calling. Default model must be one that supports function calling; make it configurable. If the chosen model returns tool calls in an unexpected shape, the adapter normalises it or returns `stopReason: 'error'` with a clear message. Verify the current base URL and tool-capable model names in the Token Factory docs before implementing.

### 7.3 The agent loop

Hand-written in `agent/loop.ts`. Pseudocode:

```
run = createRun(question, provider, model, promptVersion)
messages = [user(question)]
for step in 1..MAX_STEPS:
    check budget (steps, tokens, wall time) -> if exceeded: finish run as 'budget_exceeded'
    response = withRetry(() => provider.chat(...))
    persist step (type 'llm_call', usage, latency, cost)
    if response.stopReason == 'tool_use':
        for each toolCall:
            validate input with tool's zod schema
              -> on failure: return structured error to the model as tool_result (is_error), persist, continue
            result = execute tool with timeout
              -> on exception: return structured error to the model, persist, continue
            persist step (type 'tool_call', input, output, duration)
            append tool_result to messages
        continue
    if response.stopReason == 'end_turn':
        answer = parseFinalAnswer(response.text) with repair loop (7.5)
        persist final answer, mark run 'completed'
        return
mark run 'max_steps_exceeded'
```

Rules:

- `MAX_STEPS` default 10, configurable.
- Tool execution timeout default 5 s.
- Parallel tool calls from one LLM response may run concurrently with `Promise.all`, each persisted as its own step.
- Every state change is persisted **before** the next LLM call, so a crash at any point is resumable.
- The loop emits events (`run_started`, `step_started`, `step_completed`, `run_completed`, `run_failed`) to an in-process event bus consumed by the SSE route.

### 7.4 Tools

Each tool has: `name`, `description` (written for the model, includes when to use and when not to use), zod `input` schema, zod `output` schema, `execute()` function. Outputs are compact JSON (no huge payloads; cap rows at 50 and say so in the output).

| Tool | Source | Purpose |
|---|---|---|
| `list_campaigns` | Postgres | List campaigns with filters (advertiser, country, platform, status). Used to discover IDs. |
| `get_campaign_metrics` | Postgres | Daily or aggregated metrics for one or more campaigns in a date range: spend, clicks, installs, revenue, CPI, ROAS. Aggregation in SQL. |
| `compare_campaign_periods` | Postgres | Compare two date ranges for a set of campaigns, return absolute and percentage deltas, sorted by a chosen metric. This is the workhorse for "what changed" questions. |
| `resolve_campaign_id` | Postgres mapping table | Translate between internal campaign IDs and attribution provider IDs. Exists because the sources disagree on identifiers (fragmented data). |
| `get_attribution_data` | Mock attribution API (HTTP) | Installs, D1/D7 retention and in-app events per attribution campaign ID and date range. Called over HTTP to simulate an external system, including occasional injected latency and 5xx errors. |
| `get_fraud_signals` | CSV | Fraud flags per campaign, country and date: suspicious install rate, click-to-install time anomalies, flagged sub-publishers. |

**Why no free-form SQL tool:** Generated SQL is the classic brittle prompt chain. It breaks on schema changes, is hard to evaluate and is a security risk. Typed, parameterised tools are stable across model changes and their outputs can be unit tested. This decision should be explicit in the README.

### 7.5 Final answer schema and repair loop

The final model message must contain a JSON object matching:

```ts
FinalAnswer = {
  summary: string,                 // 2 to 5 sentences, plain language for a UA manager
  findings: {
    campaignId: string,
    campaignName: string,
    metric: string,                // e.g. 'roas'
    before: number | null,
    after: number | null,
    changePct: number | null,
    likelyCause: string,
    evidence: string[]             // references to step ids that produced the numbers
  }[],
  caveats: string[],               // data gaps, uncertainty, assumptions
  confidence: 'high' | 'medium' | 'low'
}
```

Repair loop (`agent/repair.ts`):

1. Extract JSON from the model text (tolerate code fences).
2. Validate with zod.
3. On failure, send one follow-up message containing the zod error list and ask for corrected JSON only. Maximum 2 repair attempts.
4. If still invalid, mark run `failed_validation` and store the raw text. Never show unvalidated output as a successful answer.

**Grounding check:** after validation, verify that every numeric `before`/`after` in `findings` appears in (or is derivable by rounding from) an actual tool output in the run. If not, downgrade `confidence` to `low` and add a caveat. This is a cheap hallucination guardrail.

### 7.6 Retry and error classification

`llm/retry.ts`:

- Retry with exponential backoff and jitter on: network errors, HTTP 429, 5xx, provider overload errors.
- Do not retry on: 400 validation errors, auth errors, context length errors.
- Max 3 attempts, base delay 500 ms, respect `retry-after` header if present.
- Each retry attempt is logged and counted in step metadata.

### 7.7 Persistence and resume

Tables (Section 8) `agent_runs` and `agent_steps` store the full conversation state. `agent/resume.ts`:

- `resumeRun(runId)`: rebuild `messages` from persisted steps in order, then continue the loop from the next step number.
- Must not re-execute a tool call that already has a persisted result.
- Exposed via `POST /runs/:id/resume`.
- Demo path: a `KILL_AFTER_STEP` env var (dev only) that throws after step N to simulate a crash, then resume completes the run.

### 7.8 Budgets and cost

- Per run limits: max steps, max total tokens, max wall time (defaults 10, 50k, 90 s).
- `llm/pricing.ts` holds per-model input/output prices (config object, easy to update). Cost is computed per step and summed per run.
- Run record stores totals: tokens in/out, cost USD, latency ms, number of retries, number of repairs.

### 7.9 Prompt versioning

- System prompt lives in `agent/prompts.ts` with an exported `PROMPT_VERSION` string (e.g. `v1.0.0`).
- Every run stores the prompt version, provider and model. Evals report results per prompt version. Changing the prompt without bumping the version is a review error.

---

## 8. Data model

### 8.1 Postgres tables (Drizzle)

```
advertisers
  id (pk, text), name, vertical ('gaming' | 'fintech' | 'shopping' | 'streaming')

campaigns
  id (pk, text, e.g. 'cmp_001'), advertiser_id (fk), name,
  country (ISO-2), platform ('ios' | 'android'),
  payout_model ('cpi' | 'cpa'), status ('active' | 'paused'),
  created_at

campaign_daily_metrics
  campaign_id (fk), date, spend_usd (numeric), clicks (int),
  installs (int), revenue_usd (numeric)
  pk (campaign_id, date)
  -- CPI and ROAS are computed, never stored

campaign_id_mappings
  internal_campaign_id (fk), attribution_campaign_id (text, e.g. 'af_9f3a')

agent_runs
  id (uuid pk), question, status
    ('running' | 'completed' | 'failed' | 'failed_validation' | 'budget_exceeded' | 'max_steps_exceeded'),
  provider, model, prompt_version,
  final_answer (jsonb, nullable), error (text, nullable),
  total_input_tokens, total_output_tokens, total_cost_usd, total_latency_ms,
  retries, repairs, created_at, completed_at

agent_steps
  id (uuid pk), run_id (fk), step_number, type ('llm_call' | 'tool_call' | 'repair'),
  tool_name (nullable), input (jsonb), output (jsonb), is_error (bool),
  input_tokens, output_tokens, cost_usd, latency_ms, created_at
  unique (run_id, step_number)
```

Add indexes on `campaign_daily_metrics(date)` and `agent_steps(run_id)`. Be ready to explain why.

### 8.2 Mock attribution API

Served by the same Fastify process under `/mock/attribution/*` (separate plugin) but called by the tool over HTTP, as if external.

- `GET /mock/attribution/campaigns/:attributionId/stats?from=&to=` returns installs, d1_retention, d7_retention, purchase_events per day.
- Installs differ slightly from internal installs (realistic attribution discrepancy of 2 to 8 percent).
- Injected faults controlled by env: `ATTRIBUTION_FAILURE_RATE` (default 0.1 returns 503), `ATTRIBUTION_LATENCY_MS` (default 200 to 800 random).

### 8.3 Fraud CSV

`apps/api/data/fraud_signals.csv`, generated by the seed script:

```
date,campaign_id,country,suspicious_install_rate,median_ctit_seconds,flagged_sub_publishers
```

`ctit` = click-to-install time. Very low median CTIT (under 10 s) indicates click injection.

### 8.4 Deterministic seed with injected scenarios

`seed.ts` uses a fixed random seed. It generates 8 advertisers, 24 campaigns, 60 days of metrics with weekly seasonality and noise, and **injects documented anomalies** in `scenarios.ts`. These anomalies are the ground truth for evals:

| ID | Scenario | Expected agent finding |
|---|---|---|
| S1 | `cmp_007` ROAS drops ~45% in the last 7 days; installs stable, revenue down; fraud CSV shows suspicious install rate jump to 30% and CTIT under 8 s in one country | ROAS drop caused by fraudulent installs (click injection) |
| S2 | `cmp_012` spend doubles in the last 7 days, installs up only 10% | CPI spike, efficiency drop, likely bid increase without scale |
| S3 | `cmp_018` installs fine but D7 retention in attribution data halves | Low quality users, revenue will lag |
| S4 | `cmp_003` attribution API reports 40% fewer installs than internal for last 5 days | Tracking/attribution discrepancy, not a performance change |
| S5 | `cmp_021` paused 10 days ago | Agent should mention it is paused, not call it a drop |
| S6 | Healthy control campaigns | Agent should not invent problems |

`scenarios.ts` exports this table as typed data so the eval runner can import ground truth directly.

---

## 9. API

All request and response bodies validated with zod schemas from `packages/shared`.

| Method | Path | Description |
|---|---|---|
| GET | `/health` | DB and provider config check |
| GET | `/campaigns` | List campaigns (for UI context sidebar) |
| POST | `/runs` | Body `{ question, provider? }`. Creates a run, starts the loop asynchronously, returns `{ runId }` |
| GET | `/runs` | Recent runs (history) |
| GET | `/runs/:id` | Run with all steps and final answer |
| GET | `/runs/:id/events` | Server-Sent Events stream of agent events |
| POST | `/runs/:id/resume` | Resume an interrupted run |

Error responses follow one shape: `{ error: { code, message, details? } }`.

---

## 10. Front end

### 10.1 Screens and components

Single page, three areas:

1. **Left sidebar: Run history.** Past questions with status badge, provider, cost. Click to load.
2. **Main: Question and answer.**
   - `ChatInput`: text area, provider selector (Claude / Nebius), submit. Three example question chips.
   - `AnswerCard`: summary, confidence badge, caveats list.
   - `DataTable`: findings table (campaign, metric, before, after, change %, likely cause). Change % colour coded.
3. **Right panel: Step trace** (`StepTrace`). Live via SSE. Each step shows type, tool name, collapsible input/output JSON, latency, tokens, cost, retry/error badges. Footer shows run totals.

States to handle explicitly: idle, running (streaming steps), completed, failed (with error and a "Resume" button if resumable), failed_validation (show raw text in a warning box).

Use `data-testid` attributes on all interactive and assertion-relevant elements for Playwright.

### 10.2 Example questions (also used as eval seeds)

1. "Which 3 campaigns had the biggest ROAS drop last week compared to the week before, and why?"
2. "Is cmp_007 performing worse because of fraud?"
3. "Why did CPI go up for cmp_012?"
4. "Which campaigns have good install volume but poor user quality?"
5. "Do our internal install numbers match the attribution provider for all active campaigns last week?"
6. "Give me a short Monday summary of anything unusual in the last 7 days."

---

## 11. Evals and testing

### 11.1 Eval suite (`evals/`)

- 15 cases minimum. Each case: `id`, `question`, `expected` (campaign IDs that must appear in findings, expected direction of change, expected cause keywords, tools that must be called, campaigns that must not be flagged).
- Cases derive from `scenarios.ts` (S1 to S6) plus adversarial ones:
  - Question about a campaign ID that does not exist (agent must say so, not invent)
  - Ambiguous question (agent should state its assumption in caveats)
  - Question while attribution API is failing (agent must report the data gap in caveats)
- **Scorers:**
  - `numeric.ts`: numbers in findings within tolerance (±2%) of ground truth computed directly from DB
  - `toolUsage.ts`: required tools called, no forbidden behaviour (e.g. more than 8 steps for a simple question)
  - `judge.ts` (optional, behind a flag): LLM-as-judge with a rubric for cause explanation quality, using a cheap model, scored 1 to 5. Judge output itself validated with zod.
- **Runner:** `pnpm eval --provider anthropic|nebius|all --cases all|S1,S2`
  - Runs cases with concurrency 3
  - Outputs a console table and `evals/reports/<timestamp>.json` and `.md`
  - Report columns: case, pass/fail per scorer, steps, tokens, cost, latency, provider, model, prompt version
  - Summary: pass rate per provider, total cost, p50/p95 latency
- The provider comparison report is the main input for choosing a model. Make the Markdown report readable.

### 11.2 Automated tests

| Type | Tool | Scope |
|---|---|---|
| Unit | Vitest | Each tool against a seeded test DB; repair loop; retry classification; grounding check; pricing; ID resolution |
| Agent loop | Vitest | A `FakeProvider` implementing `LLMProvider` that replays scripted responses. Test: happy path, invalid tool input, tool exception, invalid final JSON then repaired, budget exceeded, resume after crash |
| API | Vitest + Fastify `inject` | Route validation and error shapes |
| E2E | Playwright | Ask a question with `FakeProvider` enabled via env, see steps stream in, see answer and table; failed run shows Resume; history lists run |

`FakeProvider` is mandatory. It makes the agent loop testable without API calls, deterministically, like any other code path.

---

## 12. Milestones

### M1: Foundation

- Monorepo, TypeScript strict, lint, Vitest set up
- Docker Compose Postgres, Drizzle schema, migrations
- Deterministic seed with all scenarios S1 to S6, fraud CSV generation
- Fastify server with `/health` and `/campaigns`
- **Acceptance:** `docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev:api` works; `GET /campaigns` returns 24 campaigns; a SQL query confirms S1 anomaly exists; tests pass.

### M2: Tools and data sources

- All six tools with zod schemas and unit tests
- Mock attribution API with fault injection
- Fraud CSV loader
- **Acceptance:** each tool callable from a test with expected output for S1 to S5; `compare_campaign_periods` returns `cmp_007` as top ROAS drop.

### M3: LLM layer and agent loop

- `LLMProvider`, Anthropic adapter, Nebius adapter, registry, retry, pricing
- Agent loop, persistence, final answer schema, repair loop, grounding check, budgets
- `FakeProvider` and loop tests
- `POST /runs`, `GET /runs/:id`, SSE events route
- **Acceptance:** `curl` a question for S1 with Anthropic and with Nebius; both complete and persist all steps; loop tests pass with `FakeProvider`.

### M4: Front end

- Layout, chat input with provider selector, answer card, findings table, live step trace, history
- **Acceptance:** a user can ask all six example questions from the browser and see live steps and final answers.

### M5: Durability features

- Resume endpoint and UI button, `KILL_AFTER_STEP` crash simulation
- Attribution API failure handling visible in caveats
- **Acceptance:** crash at step 3, resume, run completes without re-executing completed tools (verified by test and by step trace).

### M6: Evals, E2E and polish

- Eval cases, scorers, runner, Markdown report
- Playwright E2E suite
- README: architecture diagram (Mermaid), design decisions, how to run, eval results summary, next steps
- **Acceptance:** `pnpm eval --provider all` produces a report; `pnpm test` and `pnpm e2e` pass; README explains the six key design decisions in Section 14.

---

## 13. Configuration

`.env.example`:

```
DATABASE_URL=postgres://copilot:copilot@localhost:5432/copilot

LLM_PROVIDER=anthropic            # anthropic | nebius | fake
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5-5

NEBIUS_API_KEY=
NEBIUS_BASE_URL=                  # verify current Token Factory OpenAI-compatible base URL in docs
NEBIUS_MODEL=                     # choose a model with function calling support

JUDGE_PROVIDER=anthropic
JUDGE_MODEL=claude-haiku-5-5

AGENT_MAX_STEPS=10
AGENT_MAX_TOKENS=50000
AGENT_MAX_WALL_MS=90000
TOOL_TIMEOUT_MS=5000

ATTRIBUTION_FAILURE_RATE=0.1
ATTRIBUTION_LATENCY_MS_MIN=200
ATTRIBUTION_LATENCY_MS_MAX=800

KILL_AFTER_STEP=                  # dev only, simulates a crash
```

All env vars parsed and validated with zod in `config.ts`. The app must fail fast with a clear message on missing or invalid config.

Root `package.json` scripts: `dev`, `dev:api`, `dev:web`, `db:migrate`, `db:seed`, `db:reset`, `test`, `e2e`, `eval`, `lint`, `typecheck`.

---

## 14. Key design decisions (must be documented in README)

Keep them accurate to the implementation.

1. **Typed tools instead of generated SQL:** stability across model changes, testability, security.
2. **Provider abstraction with normalised messages:** switching models is configuration, proven by running the same evals on two providers.
3. **Schema-first outputs with repair loop and grounding check:** the system never acts on or displays unvalidated or ungrounded numbers.
4. **Persist before proceed:** every step is stored before the next LLM call, enabling resume and full auditability.
5. **Deterministic seed with documented anomalies:** evals have real ground truth instead of vibes.
6. **FakeProvider for deterministic agent tests:** the agent loop is tested like any other code path.

---

## 15. Success metrics for the demo

- Eval pass rate ≥ 85% on Anthropic, reported honestly for Nebius whatever it is
- Median run latency under 20 s for single-campaign questions
- Median cost per run reported and under 0.05 USD on the default Claude model
- Zero unvalidated answers shown in UI
- Crash and resume demo works live

---

## 16. Demo script (5 minutes)

1. Ask question 1. Show steps streaming in, point out the `resolve_campaign_id` step joining fragmented sources.
2. Show the answer: S1 fraud cause with evidence linked to steps.
3. Switch provider to Nebius, ask the same question. Show cost and latency difference.
4. Run with `KILL_AFTER_STEP=3`, show failure, click Resume, show completion without repeated tool calls.
5. Open the eval report: pass rate per provider, one failure case and what it taught.
6. Close with the next steps (Section 17): durable execution engine (Temporal/Inngest) instead of custom persistence, auth, real connectors, observability via OpenTelemetry, prompt regression gate in CI.

---

## 17. Future work (out of scope)

- Replace custom persistence with Temporal or Inngest for durable execution
- OpenTelemetry tracing for LLM and tool spans
- Eval gate in CI that blocks merges when pass rate drops
- Caching tool results per question window
- Prompt caching for the system prompt and tool definitions to reduce cost
- Slack bot interface for business teams
- Semantic layer (metric definitions) shared between dashboards and the agent
