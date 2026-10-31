import type { AgentRunSummary } from '@copilot/shared';
import { formatUsd, PROVIDER_LABELS } from '../lib/format';
import { PlusIcon } from './icons';
import { StatusBadge } from './StatusBadge';

interface Props {
  runs: AgentRunSummary[] | undefined;
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function groups(runs: AgentRunSummary[]): { label: string; runs: AgentRunSummary[] }[] {
  const now = new Date();
  const today = runs.filter((r) => sameDay(new Date(r.createdAt), now));
  const earlier = runs.filter((r) => !sameDay(new Date(r.createdAt), now));
  return [
    { label: 'Today', runs: today },
    { label: 'Earlier', runs: earlier },
  ].filter((g) => g.runs.length > 0);
}

function Item({ r, selected, onSelect }: { r: AgentRunSummary; selected: boolean; onSelect: () => void }) {
  const created = new Date(r.createdAt);
  // Problem states get a tinted row so they stand out while scanning, not just a small label.
  const problem = r.status !== 'completed' && r.status !== 'running';
  return (
    <li>
      <button
        type="button"
        data-testid="run-history-item"
        data-run-id={r.id}
        aria-current={selected ? 'true' : undefined}
        onClick={onSelect}
        className={`group relative block w-full rounded-md px-2.5 py-2 text-left transition-colors ${
          selected ? 'bg-surface shadow-[0_0_0_1px_var(--rule-strong)]' : 'hover:bg-surface/70'
        }`}
      >
        {selected && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent" aria-hidden />}
        <span className={`line-clamp-2 text-[13px] leading-snug ${selected ? 'font-medium text-ink' : 'text-ink/90'}`}>{r.question}</span>
        <span className="mt-1.5 flex items-center gap-2 text-xs">
          <span className={`shrink-0 whitespace-nowrap ${problem ? 'rounded px-1 py-px ' + (r.status === 'failed' ? 'bg-neg-wash' : 'bg-warn-wash') : ''}`}>
            <StatusBadge status={r.status} quiet />
          </span>
          <span className="min-w-0 truncate whitespace-nowrap text-muted">{PROVIDER_LABELS[r.provider] ?? r.provider}</span>
          <span className="num ml-auto shrink-0 text-faint" title={created.toLocaleString()}>
            {sameDay(created, new Date()) ? time(created) : day(created)}
          </span>
          <span className="num w-14 shrink-0 text-right text-muted">{formatUsd(r.totalCostUsd)}</span>
        </span>
      </button>
    </li>
  );
}

export function RunHistory({ runs, loading, selectedId, onSelect, onNew }: Props) {
  return (
    <nav aria-label="Past questions" className="flex h-full min-h-0 flex-col">
      <div className="px-3 pt-1 pb-3">
        <button
          type="button"
          data-testid="new-question"
          onClick={onNew}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-rule-strong bg-surface py-1.5 text-[13px] font-medium shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-accent hover:text-accent"
        >
          <PlusIcon size={14} />
          New question
        </button>
      </div>
      <div data-testid="run-history" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {loading && <p className="px-2.5 text-[13px] text-muted">Loading…</p>}
        {runs?.length === 0 && <p className="px-2.5 text-[13px] text-muted">Questions you ask will appear here.</p>}
        {runs &&
          groups(runs).map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="px-2.5 pb-1 text-xs font-medium text-faint">{g.label}</h2>
              <ol className="space-y-0.5">
                {g.runs.map((r) => (
                  <Item key={r.id} r={r} selected={r.id === selectedId} onSelect={() => onSelect(r.id)} />
                ))}
              </ol>
            </section>
          ))}
      </div>
    </nav>
  );
}
