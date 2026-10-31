import Anthropic from '@anthropic-ai/sdk';
import type { ChatRequest, ChatResponse, LLMProvider, NormalizedMessage, StopReason, ToolDefinition } from './provider.js';

export function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

export function toAnthropicMessages(messages: NormalizedMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    switch (m.role) {
      case 'user':
        return { role: 'user', content: m.content };
      case 'assistant': {
        // Replay Claude's own blocks verbatim: with adaptive thinking the API requires the
        // thinking blocks (and their signatures) back unchanged alongside the tool_use blocks.
        if (m.providerState?.provider === 'anthropic') {
          return { role: 'assistant', content: m.providerState.data as Anthropic.ContentBlockParam[] };
        }
        const content: Anthropic.ContentBlockParam[] = [];
        if (m.text) content.push({ type: 'text', text: m.text });
        for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input ?? {} });
        return { role: 'assistant', content };
      }
      case 'tool_results':
        // All results of one turn go back in a single user message; splitting them
        // teaches the model to stop making parallel calls.
        return {
          role: 'user',
          content: m.results.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.toolCallId,
            content: r.content,
            is_error: r.isError,
          })),
        };
    }
  });
}

export function fromAnthropicMessage(msg: Anthropic.Message, model: string, latencyMs: number): ChatResponse {
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const toolCalls = msg.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));

  let stopReason: StopReason;
  let errorMessage: string | undefined;
  switch (msg.stop_reason) {
    case 'tool_use':
      stopReason = 'tool_use';
      break;
    case 'end_turn':
    case 'stop_sequence':
      stopReason = 'end_turn';
      break;
    case 'max_tokens':
      stopReason = 'max_tokens';
      break;
    case 'refusal':
      stopReason = 'error';
      errorMessage = `Model declined the request (refusal${msg.stop_details?.category ? `: ${msg.stop_details.category}` : ''})`;
      break;
    default:
      stopReason = 'error';
      errorMessage = `Unexpected stop_reason "${String(msg.stop_reason)}"`;
  }

  return {
    stopReason,
    ...(text ? { text } : {}),
    toolCalls,
    usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
    latencyMs,
    ...(errorMessage ? { errorMessage } : {}),
    providerState: { provider: 'anthropic', model, data: msg.content },
    raw: { id: msg.id, stop_reason: msg.stop_reason, usage: msg.usage },
  };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    apiKey: string,
    private readonly effort: 'low' | 'medium' | 'high',
    timeoutMs: number,
  ) {
    // maxRetries 0: retries live in llm/retry.ts so they are counted and persisted per step.
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const started = performance.now();
    // No temperature: current Claude models reject sampling parameters with a 400.
    // Adaptive thinking (the model default) at low effort keeps tool-choice quality while
    // spending few tokens.
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      tools: toAnthropicTools(req.tools),
      messages: toAnthropicMessages(req.messages),
      output_config: { effort: this.effort },
    });
    return fromAnthropicMessage(msg, this.model, Math.round(performance.now() - started));
  }
}
