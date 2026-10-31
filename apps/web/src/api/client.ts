import {
  API_KEY_HEADER,
  AgentEvent,
  AgentRun,
  ApiError,
  CreateRunResponse,
  HealthResponse,
  ListCampaignsResponse,
  ListRunsResponse,
  type CreateRunBody,
} from '@copilot/shared';
import type { z } from 'zod';

const BASE = '/api';

/** Error raised for any non-2xx response, carrying the server's error code and message. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Every response is validated against the shared schema: the UI never renders unchecked data.
async function request<S extends z.ZodType>(path: string, schema: S, init?: RequestInit): Promise<z.output<S>> {
  const res = await fetch(`${BASE}${path}`, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiError.safeParse(body);
    throw parsed.success
      ? new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiRequestError(res.status, 'http_error', `Request failed with status ${res.status}`);
  }
  return schema.parse(body);
}

const keyHeader = (apiKey?: string | null): Record<string, string> => (apiKey ? { [API_KEY_HEADER]: apiKey } : {});

export const api = {
  health: () => request('/health', HealthResponse),
  campaigns: () => request('/campaigns', ListCampaignsResponse),
  listRuns: (limit = 50) => request(`/runs?limit=${limit}`, ListRunsResponse),
  getRun: (id: string) => request(`/runs/${id}`, AgentRun),
  resumeRun: (id: string, apiKey?: string | null) =>
    request(`/runs/${id}/resume`, CreateRunResponse, { method: 'POST', headers: keyHeader(apiKey) }),
  createRun: (body: CreateRunBody, apiKey?: string | null) =>
    request('/runs', CreateRunResponse, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...keyHeader(apiKey) },
      body: JSON.stringify(body),
    }),
};

/**
 * Follows a run over SSE. The server replays persisted steps on every (re)connect, so the
 * browser's automatic reconnect is safe: the reducer drops duplicates by step number.
 */
export function subscribeToRun(runId: string, onEvent: (e: AgentEvent) => void): () => void {
  const source = new EventSource(`${BASE}/runs/${runId}/events`);
  source.onmessage = (msg: MessageEvent<string>) => {
    const parsed = AgentEvent.safeParse(JSON.parse(msg.data));
    if (!parsed.success) return;
    onEvent(parsed.data);
    // Close before the server ends the stream, otherwise EventSource would reconnect.
    if (parsed.data.type === 'run_completed' || parsed.data.type === 'run_failed') source.close();
  };
  return () => source.close();
}
