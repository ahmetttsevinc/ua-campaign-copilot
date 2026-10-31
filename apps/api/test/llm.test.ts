import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { fromAnthropicMessage, toAnthropicMessages, toAnthropicTools } from '../src/llm/anthropic.js';
import { fromOpenAICompletion, toOpenAIMessages, toOpenAITools } from '../src/llm/openaiCompatible.js';
import { costUsd, isPriced } from '../src/llm/pricing.js';
import { type NormalizedMessage, ProviderHttpError } from '../src/llm/provider.js';
import { classifyError, RetryExhaustedError, withRetry } from '../src/llm/retry.js';
import { toolDefinitions } from '../src/tools/definitions.js';

describe('classifyError', () => {
  it('retries rate limits and honours retry-after', () => {
    const err = new Anthropic.RateLimitError(429, {}, 'slow down', new Headers({ 'retry-after': '2' }));
    expect(classifyError(err)).toMatchObject({ retryable: true, retryAfterMs: 2000 });
  });

  it('retries 5xx / overloaded and network errors from both SDKs', () => {
    expect(classifyError(new Anthropic.InternalServerError(529, {}, 'overloaded', new Headers())).retryable).toBe(true);
    expect(classifyError(new OpenAI.InternalServerError(503, {}, 'busy', new Headers())).retryable).toBe(true);
    expect(classifyError(new Anthropic.APIConnectionError({ message: 'reset' })).retryable).toBe(true);
    expect(classifyError(new OpenAI.APIConnectionError({ message: 'reset' })).retryable).toBe(true);
    expect(classifyError(new ProviderHttpError('boom', 502)).retryable).toBe(true);
  });

  it('does not retry validation, auth, context length or unknown errors', () => {
    expect(classifyError(new Anthropic.BadRequestError(400, {}, 'prompt is too long', new Headers())).retryable).toBe(false);
    expect(classifyError(new Anthropic.AuthenticationError(401, {}, 'bad key', new Headers())).retryable).toBe(false);
    expect(classifyError(new OpenAI.PermissionDeniedError(403, {}, 'nope', new Headers())).retryable).toBe(false);
    expect(classifyError(new TypeError('undefined is not a function')).retryable).toBe(false);
  });
});

describe('withRetry', () => {
  const noSleep = async () => undefined;

  it('retries transient failures with growing backoff and reports the count', async () => {
    const delays: number[] = [];
    let calls = 0;
    const r = await withRetry(
      async () => {
        if (++calls < 3) throw new ProviderHttpError('busy', 503);
        return 'ok';
      },
      { maxAttempts: 3, baseDelayMs: 500, random: () => 0.5, sleep: async (ms) => void delays.push(ms) },
    );
    expect(r).toMatchObject({ value: 'ok', retries: 2 });
    expect(delays).toEqual([500, 1000]);
  });

  it('uses retry-after when the provider sends one, capped by maxDelayMs', async () => {
    const delays: number[] = [];
    let calls = 0;
    await withRetry(
      async () => {
        if (++calls === 1) throw new ProviderHttpError('slow down', 429, 60_000);
        return 1;
      },
      { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5000, sleep: async (ms) => void delays.push(ms) },
    );
    expect(delays).toEqual([5000]);
  });

  it('gives up after maxAttempts', async () => {
    await expect(withRetry(() => Promise.reject(new ProviderHttpError('down', 503)), { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep })).rejects.toMatchObject({
      attempts: 3,
      message: expect.stringMatching(/Gave up after 3 attempts/),
    });
  });

  it('fails immediately on non-retryable errors', async () => {
    let calls = 0;
    const p = withRetry(
      () => {
        calls++;
        return Promise.reject(new ProviderHttpError('bad request', 400));
      },
      { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep },
    );
    await expect(p).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(calls).toBe(1);
  });
});

describe('pricing', () => {
  it('computes cost per model from token usage', () => {
    expect(costUsd('claude-haiku-5-5', { inputTokens: 10_000, outputTokens: 1_000 })).toBeCloseTo(0.0015, 8);
    expect(costUsd('claude-sonnet-5-5', { inputTokens: 10_000, outputTokens: 1_000 })).toBeCloseTo(0.03, 8);
    expect(costUsd('Qwen/Qwen3-235B-A22B-Instruct-2507', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.2, 8);
  });

  it('applies the long-context rate above the threshold', () => {
    expect(costUsd('claude-haiku-5-5', { inputTokens: 200_000, outputTokens: 0 })).toBeCloseTo(0.1, 8);
  });

  it('returns 0 for unknown models instead of crashing', () => {
    expect(isPriced('mystery-model')).toBe(false);
    expect(costUsd('mystery-model', { inputTokens: 1000, outputTokens: 1000 })).toBe(0);
  });
});

const conversation: NormalizedMessage[] = [
  { role: 'user', content: 'Why did ROAS drop?' },
  { role: 'assistant', text: 'Checking.', toolCalls: [{ id: 'c1', name: 'list_campaigns', input: {} }, { id: 'c2', name: 'get_fraud_signals', input: { period: { from: 'a', to: 'b' } } }] },
  {
    role: 'tool_results',
    results: [
      { toolCallId: 'c1', toolName: 'list_campaigns', content: '{"ref":"step_2"}', isError: false },
      { toolCallId: 'c2', toolName: 'get_fraud_signals', content: '{"ref":"step_3"}', isError: true },
    ],
  },
];

describe('Anthropic adapter', () => {
  it('sends all tool results of one turn in a single user message', () => {
    const msgs = toAnthropicMessages(conversation);
    expect(msgs).toHaveLength(3);
    expect(msgs[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'c1', content: '{"ref":"step_2"}', is_error: false },
        { type: 'tool_result', tool_use_id: 'c2', content: '{"ref":"step_3"}', is_error: true },
      ],
    });
    expect(msgs[1]?.content).toEqual([
      { type: 'text', text: 'Checking.' },
      { type: 'tool_use', id: 'c1', name: 'list_campaigns', input: {} },
      { type: 'tool_use', id: 'c2', name: 'get_fraud_signals', input: { period: { from: 'a', to: 'b' } } },
    ]);
  });

  it('replays its own blocks verbatim (thinking signatures must survive)', () => {
    const blocks = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'c1', name: 'x', input: {} }];
    const msgs = toAnthropicMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', toolCalls: [{ id: 'c1', name: 'x', input: {} }], providerState: { provider: 'anthropic', model: 'm', data: blocks } },
    ]);
    expect(msgs[1]?.content).toBe(blocks);
  });

  it('normalises a response with thinking, text and tool use', () => {
    const msg = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      stop_reason: 'tool_use',
      stop_details: null,
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'tu_1', name: 'list_campaigns', input: { status: 'paused' } },
      ],
      usage: { input_tokens: 1200, output_tokens: 80 },
    } as unknown as Anthropic.Message;
    const r = fromAnthropicMessage(msg, 'claude-haiku-5-5', 42);
    expect(r).toMatchObject({
      stopReason: 'tool_use',
      text: 'Let me check.',
      toolCalls: [{ id: 'tu_1', name: 'list_campaigns', input: { status: 'paused' } }],
      usage: { inputTokens: 1200, outputTokens: 80 },
      latencyMs: 42,
      providerState: { provider: 'anthropic', data: msg.content },
    });
  });

  it('maps a refusal to an error turn with a clear message', () => {
    const msg = {
      id: 'm',
      content: [],
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: null },
      usage: { input_tokens: 1, output_tokens: 0 },
    } as unknown as Anthropic.Message;
    expect(fromAnthropicMessage(msg, 'm', 1)).toMatchObject({ stopReason: 'error', errorMessage: expect.stringMatching(/refusal: cyber/) });
  });

  it('builds tools with JSON schema input', () => {
    const [t] = toAnthropicTools([{ name: 'a', description: 'd', inputSchema: { type: 'object', properties: {} } }]);
    expect(t).toEqual({ name: 'a', description: 'd', input_schema: { type: 'object', properties: {} } });
  });
});

describe('Nebius (OpenAI-compatible) adapter', () => {
  it('converts to OpenAI messages with one tool message per result', () => {
    const msgs = toOpenAIMessages('sys', conversation);
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'tool']);
    expect(msgs[2]).toMatchObject({
      role: 'assistant',
      content: 'Checking.',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'list_campaigns', arguments: '{}' } },
        { id: 'c2', type: 'function', function: { name: 'get_fraud_signals', arguments: '{"period":{"from":"a","to":"b"}}' } },
      ],
    });
    expect(msgs[4]).toEqual({ role: 'tool', tool_call_id: 'c2', content: '{"ref":"step_3"}' });
    expect(toOpenAITools([{ name: 'a', description: 'd', inputSchema: {} }])[0]).toEqual({
      type: 'function',
      function: { name: 'a', description: 'd', parameters: {} },
    });
  });

  const completion = (message: object, finish_reason: string) =>
    ({
      id: 'cmpl_1',
      choices: [{ index: 0, finish_reason, message: { role: 'assistant', content: null, ...message } }],
      usage: { prompt_tokens: 500, completion_tokens: 40, total_tokens: 540 },
    }) as unknown as OpenAI.Chat.Completions.ChatCompletion;

  it('parses tool calls and treats them as tool_use even when finish_reason is "stop"', () => {
    const r = fromOpenAICompletion(
      completion({ tool_calls: [{ id: 't1', type: 'function', function: { name: 'list_campaigns', arguments: '{"status":"paused"}' } }] }, 'stop'),
      'nebius',
      'qwen',
      10,
    );
    expect(r).toMatchObject({ stopReason: 'tool_use', toolCalls: [{ id: 't1', name: 'list_campaigns', input: { status: 'paused' } }], usage: { inputTokens: 500, outputTokens: 40 } });
  });

  it('keeps invalid JSON arguments as a raw string and fills in missing ids', () => {
    const r = fromOpenAICompletion(
      completion({ tool_calls: [{ id: '', type: 'function', function: { name: 'x', arguments: '{oops' } }] }, 'tool_calls'),
      'nebius',
      'qwen',
      10,
    );
    expect(r.toolCalls[0]).toEqual({ id: 'call_cmpl_1_0', name: 'x', input: '{oops' });
  });

  it('maps stop -> end_turn, length -> max_tokens, anything else -> error', () => {
    expect(fromOpenAICompletion(completion({ content: '{"a":1}' }, 'stop'), 'nebius', 'q', 1)).toMatchObject({ stopReason: 'end_turn', text: '{"a":1}' });
    expect(fromOpenAICompletion(completion({ content: 'partial' }, 'length'), 'nebius', 'q', 1).stopReason).toBe('max_tokens');
    expect(fromOpenAICompletion(completion({ content: '' }, 'content_filter'), 'nebius', 'q', 1)).toMatchObject({ stopReason: 'error', errorMessage: expect.stringMatching(/content_filter/) });
  });
});

describe('toolDefinitions', () => {
  it('generates one JSON schema per tool from the zod input schemas', () => {
    const defs = toolDefinitions();
    expect(defs).toHaveLength(6);
    for (const d of defs) {
      expect(d.inputSchema.type).toBe('object');
      expect(d.inputSchema).not.toHaveProperty('$schema');
    }
    const compare = defs.find((d) => d.name === 'compare_campaign_periods')?.inputSchema as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { default?: unknown }>;
    };
    expect(compare.required.sort()).toEqual(['after', 'before']);
    expect(compare.additionalProperties).toBe(false);
    expect(compare.properties.sortBy?.default).toBe('roas');
  });
});
