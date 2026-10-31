// Dev helper: ask the running API a question and follow the run live over SSE.
//   pnpm ask "Why did CPI go up for cmp_012?" --provider nebius
//   pnpm ask --follow <runId>
import { AgentEvent, type AgentRunSummary, CreateRunResponse } from '@copilot/shared';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const base = flag('url') ?? `http://127.0.0.1:${process.env.API_PORT ?? 3001}`;
const provider = flag('provider');
const follow = flag('follow');
const question = args.join(' ').trim();
if (!follow && !question) {
  console.error('Usage: pnpm ask "<question>" [--provider anthropic|nebius|fake]  |  pnpm ask --follow <runId>');
  process.exit(1);
}

let runId = follow;
if (!runId) {
  const res = await fetch(`${base}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(provider ? { question, provider } : { question }),
  });
  if (!res.ok) {
    console.error(`POST /runs failed (${res.status}):`, await res.text());
    process.exit(1);
  }
  runId = CreateRunResponse.parse(await res.json()).runId;
}
console.log(`run ${runId}`);

const short = (v: unknown, n = 140) => {
  const s = JSON.stringify(v) ?? '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
const totals = (r: AgentRunSummary) =>
  `${r.status} | ${r.provider}/${r.model} | $${r.totalCostUsd.toFixed(4)} | tokens ${r.totalInputTokens}/${r.totalOutputTokens} | ${r.totalLatencyMs} ms | retries ${r.retries} | repairs ${r.repairs}`;

const stream = await fetch(`${base}/runs/${runId}/events`);
if (!stream.ok || !stream.body) {
  console.error(`GET /runs/${runId}/events failed (${stream.status})`);
  process.exit(1);
}
const decoder = new TextDecoder();
let buffer = '';
for await (const chunk of stream.body) {
  buffer += decoder.decode(chunk as Uint8Array, { stream: true });
  let idx;
  while ((idx = buffer.indexOf('\n\n')) !== -1) {
    const frame = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    if (!frame.startsWith('data: ')) continue;
    const e = AgentEvent.parse(JSON.parse(frame.slice(6)));
    if (e.type === 'step_completed') {
      const s = e.step;
      const out = s.output as { stopReason?: string; toolCalls?: { name: string }[]; ok?: boolean; error?: unknown };
      const detail =
        s.type === 'llm_call'
          ? `${out.stopReason} ${out.toolCalls?.map((c) => c.name).join(', ') ?? ''}`
          : s.type === 'tool_call'
            ? `${s.toolName} ${short((s.input as { input: unknown }).input)}${out.ok ? '' : ` ERROR ${short(out.error)}`}`
            : short(s.input);
      console.log(`  step ${String(s.stepNumber).padStart(2)} ${s.type.padEnd(9)} ${String(s.latencyMs).padStart(5)} ms  ${detail}`);
    } else if (e.type === 'run_completed' || e.type === 'run_failed') {
      console.log(`=> ${totals(e.run)}`);
      if (e.run.error) console.log(`error: ${e.run.error}`);
      if (e.run.finalAnswer) console.log(JSON.stringify(e.run.finalAnswer, null, 2));
    }
  }
}
