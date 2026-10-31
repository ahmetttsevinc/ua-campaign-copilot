import type { ProviderName } from '@copilot/shared';
import { useEffect, useState } from 'react';
import { ApiRequestError } from './api/client';
import { useCampaigns, useCreateRun, useHealth, useResumeRun, useRun, useRuns } from './api/hooks';
import { AnswerCard } from './components/AnswerCard';
import { ChatInput } from './components/ChatInput';
import { RunHistory } from './components/RunHistory';
import { StepTrace } from './components/StepTrace';
import { getApiKey } from './lib/apiKeys';
import { EvidenceProvider } from './lib/evidence';

// The selected run lives in the URL hash so a reload or a shared link reopens it.
function readRunFromHash(): string | null {
  const m = /^#\/runs\/([0-9a-f-]{36})$/i.exec(window.location.hash);
  return m?.[1] ?? null;
}

function useSelectedRun(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(readRunFromHash);
  useEffect(() => {
    const onHash = () => setId(readRunFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const select = (next: string | null) => {
    window.location.hash = next ? `/runs/${next}` : '';
    setId(next);
  };
  return [id, select];
}

const dataDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Idle state: tell Lena what the copilot can see before she asks anything.
function Sources() {
  const sources = [
    ['Internal database', 'Spend, clicks, installs and revenue per campaign per day'],
    ['Attribution provider', 'Attributed installs, D1 and D7 retention, purchases'],
    ['Fraud vendor', 'Suspicious install rate, click-to-install time, flagged sub-publishers'],
  ];
  return (
    <section aria-labelledby="sources-heading" className="max-w-3xl border-t border-rule pt-6">
      <h2 id="sources-heading" className="text-sm font-semibold">
        What the copilot reads
      </h2>
      <dl className="mt-3 grid gap-4 sm:grid-cols-3">
        {sources.map(([name, what]) => (
          <div key={name} className="border-l-2 border-rule pl-3">
            <dt className="text-sm font-medium">{name}</dt>
            <dd className="mt-0.5 text-sm leading-snug text-muted">{what}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-muted">
        It joins these sources for you, shows each step it takes, and never reports a number it did not read from one of them.
      </p>
    </section>
  );
}

export function App() {
  const [selectedId, select] = useSelectedRun();
  const health = useHealth();
  const campaigns = useCampaigns();
  const runs = useRuns();
  const run = useRun(selectedId);
  const createRun = useCreateRun((id) => select(id));
  const resumeRun = useResumeRun(selectedId);

  const serverDefault = health.data?.provider.name ?? 'anthropic';
  // The server decides what is offered (the scripted provider only when it runs on it) and which need a user key.
  const providers = health.data?.providers ?? [];

  const submitError =
    createRun.error instanceof ApiRequestError ? createRun.error.message : createRun.error ? 'Could not reach the server. Is the API running?' : null;

  return (
    <EvidenceProvider>
      <div className="grid min-h-screen grid-cols-1 lg:h-screen lg:grid-cols-[17rem_minmax(0,1fr)_25rem]">
        <aside className="flex min-h-0 flex-col border-rule bg-paper lg:border-r">
          <div className="border-b border-rule px-4 py-4">
            <h1 className="text-base font-bold tracking-tight">UA Campaign Copilot</h1>
            <p data-testid="data-context" className="mt-0.5 text-xs text-muted">
              {campaigns.data ? `${campaigns.data.campaigns.length} campaigns, data through ${dataDate(campaigns.data.dataEndDate)}` : ' '}
            </p>
          </div>
          <div className="min-h-0 flex-1">
            <RunHistory runs={runs.data} loading={runs.isLoading} selectedId={selectedId} onSelect={select} onNew={() => select(null)} />
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto bg-surface">
          <div className="mx-auto max-w-5xl space-y-10 px-6 py-8 lg:px-10">
            {health.data && (
              <ChatInput
                key={serverDefault}
                compact={selectedId !== null}
                providers={providers}
                defaultProvider={serverDefault}
                submitting={createRun.isPending}
                error={submitError}
                onSubmit={(question, provider, apiKey) => createRun.mutate({ body: { question, provider }, apiKey })}
              />
            )}
            {health.isError && (
              <p role="alert" className="text-sm text-bad">
                The API is not reachable. Start it with <code>pnpm dev:api</code> and reload.
              </p>
            )}
            {selectedId && run.isLoading && <p className="text-sm text-muted">Loading run…</p>}
            {selectedId && run.isError && (
              <p role="alert" className="text-sm text-bad">
                This run could not be loaded. It may have been deleted.
              </p>
            )}
            {run.data && (
              <AnswerCard
                run={run.data}
                resume={{
                  // Resume needs the same user key again if the server has none for this provider.
                  onResume: () => resumeRun.mutate(getApiKey(run.data.provider as ProviderName)),
                  resuming: resumeRun.isPending,
                  error: resumeRun.error ? resumeRun.error.message : null,
                }}
              />
            )}
            {!selectedId && <Sources />}
          </div>
        </main>

        <aside className="min-h-0 border-rule bg-surface lg:border-l">
          <StepTrace run={selectedId ? run.data : undefined} />
        </aside>
      </div>
    </EvidenceProvider>
  );
}
