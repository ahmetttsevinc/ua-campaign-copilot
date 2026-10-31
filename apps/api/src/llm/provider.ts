import type { ProviderName } from '@copilot/shared';

/**
 * The one internal message format. Agent code only ever sees these types; each adapter
 * translates to and from its provider's native shape. Swapping models is therefore a
 * config change, never an agent-code change.
 */

export interface ToolCall {
  id: string;
  name: string;
  /** Unvalidated: whatever the model sent. runTool validates it against the tool's zod schema. */
  input: unknown;
}

export interface ToolResultContent {
  toolCallId: string;
  toolName: string;
  /** Serialised JSON string sent back to the model. */
  content: string;
  isError: boolean;
}

/**
 * Opaque provider data attached to an assistant turn. Some providers (Claude with adaptive
 * thinking) require their own blocks to be replayed verbatim on the next request. The agent
 * stores and returns this blob without looking inside; only the adapter that produced it reads it.
 */
export interface ProviderState {
  provider: ProviderName;
  model: string;
  data: unknown;
}

export type NormalizedMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; text?: string; toolCalls: ToolCall[]; providerState?: ProviderState }
  | { role: 'tool_results'; results: ToolResultContent[] };

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema generated from the tool's zod input schema (single source of truth). */
  inputSchema: Record<string, unknown>;
}

export interface ChatRequest {
  system: string;
  messages: NormalizedMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
  /** Honoured only by providers that accept it; current Claude models reject sampling params. */
  temperature?: number;
}

export type StopReason = 'tool_use' | 'end_turn' | 'max_tokens' | 'error';

export interface ChatResponse {
  stopReason: StopReason;
  text?: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  /** Set when stopReason is 'error': why the provider could not produce a usable turn. */
  errorMessage?: string;
  providerState?: ProviderState;
  /** Stored for debugging, never used by logic. */
  raw?: unknown;
}

export interface LLMProvider {
  readonly name: ProviderName;
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

/** Thrown by adapters (and FakeProvider) for HTTP-level failures, so retry can classify them uniformly. */
export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}
