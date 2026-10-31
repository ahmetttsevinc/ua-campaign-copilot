import OpenAI from 'openai';
import type { ChatRequest, ChatResponse, LLMProvider, NormalizedMessage, StopReason, ToolCall, ToolDefinition } from './provider.js';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export function toOpenAITools(tools: ToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

export function toOpenAIMessages(system: string, messages: NormalizedMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    switch (m.role) {
      case 'user':
        out.push({ role: 'user', content: m.content });
        break;
      case 'assistant':
        out.push({
          role: 'assistant',
          content: m.text ?? null,
          ...(m.toolCalls.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function' as const,
                  // Invalid JSON from the model is kept as the raw string so the transcript stays faithful.
                  function: { name: c.name, arguments: typeof c.input === 'string' ? c.input : JSON.stringify(c.input ?? {}) },
                })),
              }
            : {}),
        });
        break;
      case 'tool_results':
        // OpenAI format: one `tool` message per result.
        for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
        break;
    }
  }
  return out;
}

export function fromOpenAICompletion(
  completion: OpenAI.Chat.Completions.ChatCompletion,
  provider: 'nebius',
  model: string,
  latencyMs: number,
): ChatResponse {
  const usage = {
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
  };
  const choice = completion.choices[0];
  if (!choice) {
    return { stopReason: 'error', errorMessage: 'Provider returned no choices', toolCalls: [], usage, latencyMs, raw: completion };
  }

  const toolCalls: ToolCall[] = [];
  for (const [i, tc] of (choice.message.tool_calls ?? []).entries()) {
    if (tc.type !== 'function') {
      return { stopReason: 'error', errorMessage: `Unsupported tool call type "${tc.type}"`, toolCalls: [], usage, latencyMs, raw: completion };
    }
    let input: unknown;
    try {
      input = JSON.parse(tc.function.arguments || '{}');
    } catch {
      // Keep the raw string: tool validation will reject it and tell the model to fix its JSON,
      // which is recoverable, unlike failing the whole run here.
      input = tc.function.arguments;
    }
    // Some open-model servers omit ids; the agent needs them to pair calls with results.
    toolCalls.push({ id: tc.id || `call_${completion.id}_${i}`, name: tc.function.name, input });
  }

  const text = choice.message.content?.trim();
  let stopReason: StopReason;
  // Open models sometimes report finish_reason "stop" while still returning tool calls; the
  // tool calls are what matter.
  if (toolCalls.length > 0) stopReason = 'tool_use';
  else if (choice.finish_reason === 'stop') stopReason = 'end_turn';
  else if (choice.finish_reason === 'length') stopReason = 'max_tokens';
  else stopReason = 'error';

  return {
    stopReason,
    ...(text ? { text } : {}),
    toolCalls,
    usage,
    latencyMs,
    ...(stopReason === 'error' ? { errorMessage: `Unexpected finish_reason "${choice.finish_reason}"` } : {}),
    providerState: { provider, model, data: null },
    raw: { id: completion.id, finish_reason: choice.finish_reason, usage: completion.usage },
  };
}

/** Nebius Token Factory through its OpenAI-compatible endpoint, using native function calling. */
export class NebiusProvider implements LLMProvider {
  readonly name = 'nebius' as const;
  private readonly client: OpenAI;

  constructor(
    readonly model: string,
    apiKey: string,
    baseURL: string,
    timeoutMs: number,
  ) {
    this.client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: timeoutMs });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const started = performance.now();
    const completion = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: req.maxTokens,
      messages: toOpenAIMessages(req.system, req.messages),
      tools: toOpenAITools(req.tools),
      tool_choice: 'auto',
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    });
    return fromOpenAICompletion(completion, 'nebius', this.model, Math.round(performance.now() - started));
  }
}
