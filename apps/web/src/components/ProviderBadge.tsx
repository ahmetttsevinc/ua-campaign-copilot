import { PROVIDER_LABELS } from '../lib/format';

export function ProviderBadge({ provider, model, showModel = true }: { provider: string; model: string; showModel?: boolean }) {
  return (
    <span
      data-testid="provider-badge"
      title={`${PROVIDER_LABELS[provider] ?? provider}, model ${model}`}
      className="inline-flex items-baseline gap-1 rounded-sm border border-rule px-1.5 py-px text-xs text-muted"
    >
      <span className="font-medium text-ink">{PROVIDER_LABELS[provider] ?? provider}</span>
      {showModel && <span className="max-w-40 truncate">{model.replace(/^.*\//, '')}</span>}
    </span>
  );
}
