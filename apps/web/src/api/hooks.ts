import type { CreateRunBody } from '@copilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { applyEvent, type RunView, toView } from '../lib/runState';
import { api, subscribeToRun } from './client';

export const keys = {
  runs: ['runs'] as const,
  run: (id: string) => ['run', id] as const,
  health: ['health'] as const,
};

export function useHealth() {
  return useQuery({ queryKey: keys.health, queryFn: api.health, staleTime: 60_000 });
}

export function useCampaigns() {
  return useQuery({ queryKey: ['campaigns'], queryFn: api.campaigns, staleTime: 5 * 60_000 });
}

export function useRuns() {
  return useQuery({ queryKey: keys.runs, queryFn: () => api.listRuns(), select: (d) => d.runs });
}

/**
 * Loads a run, then (while it is running) streams events into the same cache entry, so
 * every component reading the run re-renders as steps arrive.
 */
export function useRun(runId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: keys.run(runId ?? 'none'),
    queryFn: async (): Promise<RunView> => toView(await api.getRun(runId as string)),
    enabled: runId !== null,
  });
  const isRunning = query.data?.status === 'running';

  useEffect(() => {
    if (!runId || !isRunning) return;
    return subscribeToRun(runId, (event) => {
      qc.setQueryData<RunView>(keys.run(runId), (old) => (old ? applyEvent(old, event) : old));
      if (event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'step_completed') {
        // Keep cost and status in the history list in step with the trace.
        void qc.invalidateQueries({ queryKey: keys.runs });
      }
    });
  }, [runId, isRunning, qc]);

  return query;
}

export function useCreateRun(onCreated: (runId: string) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, apiKey }: { body: CreateRunBody; apiKey: string | null }) => api.createRun(body, apiKey),
    onSuccess: ({ runId }) => {
      void qc.invalidateQueries({ queryKey: keys.runs });
      onCreated(runId);
    },
  });
}

export function useResumeRun(runId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string | null) => api.resumeRun(runId as string, apiKey),
    // Refetching flips the cached run to "running", which re-opens the SSE subscription.
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.run(runId ?? 'none') });
      void qc.invalidateQueries({ queryKey: keys.runs });
    },
  });
}
