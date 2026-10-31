import { PROVIDER_LABELS } from '../lib/format';

export function ProviderBadge({ provider, model, showModel = true }: { provider: string; model: string; showModel?: boolean }) {
  return (
    <span data-testid="provider-badge" title={`${PROVIDER_LABELS[provider] ?? provider}, model ${model}`} className="inline-flex min-w-0 items-baseline gap-1.5 text-xs">
      <span className="font-medium text-ink">{PROVIDER_LABELS[provider] ?? provider}</span>
      {showModel && <span className="num truncate text-muted">{model.replace(/^.*\//, '')}</span>}
    </span>
  );
}
