import type { AgentRunSummary } from '@copilot/shared';
import { formatUsd } from '../lib/format';
import { ProviderBadge } from './ProviderBadge';
import { StatusBadge } from './StatusBadge';

interface Props {
  runs: AgentRunSummary[] | undefined;
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function RunHistory({ runs, loading, selectedId, onSelect, onNew }: Props) {
  return (
    <nav aria-label="Past questions" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-rule px-4 py-3">
        <h2 className="text-sm font-semibold">Past questions</h2>
        <button type="button" data-testid="new-question" onClick={onNew} className="text-sm font-medium text-cobalt hover:underline">
          New question
        </button>
      </div>
      <ol data-testid="run-history" className="flex-1 overflow-y-auto">
        {loading && <li className="px-4 py-3 text-sm text-muted">Loading…</li>}
        {runs?.length === 0 && <li className="px-4 py-3 text-sm text-muted">Questions you ask will appear here.</li>}
        {runs?.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              data-testid="run-history-item"
              data-run-id={r.id}
              aria-current={r.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(r.id)}
              className={`block w-full border-b border-rule/70 border-l-2 px-4 py-3 text-left hover:bg-surface ${
                r.id === selectedId ? 'border-l-cobalt bg-surface' : 'border-l-transparent'
              }`}
            >
              <span className="line-clamp-2 text-sm leading-snug">{r.question}</span>
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={r.status} />
                <ProviderBadge provider={r.provider} model={r.model} showModel={false} />
                <span className="tabular ml-auto text-xs text-muted">{formatUsd(r.totalCostUsd)}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
