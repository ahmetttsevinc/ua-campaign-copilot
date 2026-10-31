import type { ProviderName } from '@copilot/shared';
import { useEffect, useState } from 'react';
import { ApiRequestError } from './api/client';
import { useCampaigns, useCreateRun, useHealth, useResumeRun, useRun, useRuns } from './api/hooks';
import { AnswerCard } from './components/AnswerCard';
import { ChatInput } from './components/ChatInput';
import { RunHistory } from './components/RunHistory';
import { StepTrace } from './components/StepTrace';
import { getApiKey } from './lib/apiKeys';
import { DatabaseIcon, GlobeIcon, ShieldIcon } from './components/icons';
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

// Idle state: tell the user what the copilot can see before they ask anything.
function Sources() {
  const sources = [
    { name: 'Internal database', what: 'Spend, clicks, installs and revenue per campaign per day', Icon: DatabaseIcon },
    { name: 'Attribution provider', what: 'Attributed installs, D1 and D7 retention, purchases', Icon: GlobeIcon },
    { name: 'Fraud vendor', what: 'Suspicious install rate, click-to-install time, flagged sub-publishers', Icon: ShieldIcon },
  ];
  return (
    <section aria-labelledby="sources-heading" className="space-y-3">
      <h2 id="sources-heading" className="text-[13px] font-semibold">
        What the copilot reads
      </h2>
      <dl className="grid gap-3 sm:grid-cols-3">
        {sources.map(({ name, what, Icon }) => (
          <div key={name} className="rounded-lg border border-rule bg-surface p-3.5">
            <dt className="flex items-center gap-2 text-[13px] font-medium">
              <span className="flex size-6 items-center justify-center rounded-[5px] border border-rule-strong text-muted">
                <Icon size={13} />
              </span>
              {name}
            </dt>
            <dd className="mt-1.5 text-[13px] leading-snug text-muted">{what}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[13px] text-muted">It joins these sources for you, shows each step it takes, and never reports a number it did not read from one of them.</p>
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
      <div className="grid min-h-screen grid-cols-1 lg:h-screen lg:grid-cols-[244px_minmax(0,1fr)_360px] xl:grid-cols-[264px_minmax(0,1fr)_400px] 2xl:grid-cols-[288px_minmax(0,1fr)_460px]">
        <aside className="flex min-h-0 flex-col border-rule bg-bg lg:border-r">
          <div className="px-4 pt-4 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-md bg-ink text-bg" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 11V8m4 3V5m4 6V7" />
                </svg>
              </span>
              <h1 className="text-[14px] font-semibold tracking-tight">UA Campaign Copilot</h1>
            </div>
            <p data-testid="data-context" className="mt-1.5 text-xs text-faint">
              {campaigns.data ? `${campaigns.data.campaigns.length} campaigns, data through ${dataDate(campaigns.data.dataEndDate)}` : ' '}
            </p>
          </div>
          <div className="min-h-0 flex-1">
            <RunHistory runs={runs.data} loading={runs.isLoading} selectedId={selectedId} onSelect={select} onNew={() => select(null)} />
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto bg-surface">
          <div className="mx-auto max-w-[1180px] space-y-8 px-6 py-7 xl:px-10">
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
              <p role="alert" className="rounded-lg border border-neg/30 bg-neg-wash px-4 py-3 text-[13px] text-neg">
                The API is not reachable. Start it with <code className="num">pnpm dev:api</code> and reload.
              </p>
            )}
            {selectedId && run.isLoading && <p className="text-[13px] text-muted">Loading run…</p>}
            {selectedId && run.isError && (
              <p role="alert" className="text-[13px] text-neg">
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
