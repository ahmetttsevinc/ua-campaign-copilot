import type { ChatRequest, ChatResponse, LLMProvider, ToolCall } from './provider.js';

/**
 * Replays scripted responses so the agent loop can be tested deterministically, without
 * network or API keys. Each script entry is consumed by one chat() call.
 */
export type FakeTurn =
  | (Partial<Omit<ChatResponse, 'usage' | 'latencyMs'>> & { usage?: ChatResponse['usage']; delayMs?: number })
  | { throws: unknown };
export type FakeScriptEntry = FakeTurn | ((req: ChatRequest, callIndex: number) => FakeTurn);

export class FakeScriptExhaustedError extends Error {}

export class FakeProvider implements LLMProvider {
  readonly name = 'fake' as const;
  /** Every request received, so tests can assert on what the loop sent to the model. */
  readonly requests: ChatRequest[] = [];
  private index = 0;

  /**
   * @param indexBy 'call' consumes the script in call order (unit tests). 'turn' picks the entry
   *   from the number of assistant turns already in the conversation, so a fresh provider
   *   instance continues a resumed run where it stopped (demo and E2E mode).
   */
  constructor(
    private readonly script: FakeScriptEntry[],
    readonly model = 'fake',
    private readonly indexBy: 'call' | 'turn' = 'call',
  ) {}

  get callCount(): number {
    return this.index;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    // Deep copy: the loop keeps appending to the same messages array.
    this.requests.push(structuredClone(req));
    const callIndex = this.indexBy === 'turn' ? req.messages.filter((m) => m.role === 'assistant').length : this.index;
    this.index++;
    const entry = this.script[callIndex];
    if (!entry) throw new FakeScriptExhaustedError(`FakeProvider script exhausted at call ${callIndex + 1}`);
    const turn = typeof entry === 'function' ? entry(req, callIndex) : entry;
    if ('throws' in turn) throw turn.throws;
    const { delayMs, usage, ...rest } = turn;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const toolCalls = rest.toolCalls ?? [];
    return {
      stopReason: rest.stopReason ?? (toolCalls.length ? 'tool_use' : 'end_turn'),
      toolCalls,
      usage: usage ?? { inputTokens: 100, outputTokens: 20 },
      latencyMs: delayMs ?? 1,
      ...(rest.text !== undefined ? { text: rest.text } : {}),
      ...(rest.errorMessage !== undefined ? { errorMessage: rest.errorMessage } : {}),
      providerState: { provider: 'fake', model: this.model, data: null },
    };
  }
}

let idCounter = 0;
export const fakeToolCall = (name: string, input: unknown, id = `fake_call_${++idCounter}`): ToolCall => ({ id, name, input });
export const fakeToolTurn = (...calls: ToolCall[]): FakeTurn => ({ stopReason: 'tool_use', toolCalls: calls });
export const fakeFinalTurn = (answer: unknown): FakeTurn => ({
  stopReason: 'end_turn',
  text: typeof answer === 'string' ? answer : JSON.stringify(answer),
});
