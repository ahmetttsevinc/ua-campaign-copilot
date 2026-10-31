# CLAUDE.md

Project: UA Campaign Copilot. Full requirements are in `PRD.md`. Read it before any work.

## Rules

- Work one milestone at a time (PRD Section 12). Stop after each milestone, summarise, list verification steps, wait for review.
- No agent frameworks (LangChain, LlamaIndex, Vercel AI SDK agents, Mastra, CrewAI). The agent loop is hand-written.
- TypeScript strict. No `any` without a justifying comment.
- Validate every LLM output and every API body with zod schemas from `packages/shared`.
- The LLM never computes numbers. Aggregation lives in SQL or tool code.
- Persist each agent step before the next LLM call.
- Every new tool, route or agent behaviour ships with tests. Use `FakeProvider` for agent loop tests.
- Add `data-testid` to UI elements that tests interact with or assert on.
- Comments explain why, not what.
- If an external API or package differs from what the PRD assumes, stop and ask.

## Commands

- `docker compose up -d`
- `pnpm db:migrate && pnpm db:seed`
- `pnpm dev`
- `pnpm test` / `pnpm e2e` / `pnpm eval --provider all`
- `pnpm typecheck && pnpm lint` before declaring a milestone done
