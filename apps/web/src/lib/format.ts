import type { AgentStep } from '@copilot/shared';

type Direction = 'higher_is_better' | 'lower_is_better' | 'neutral';

interface MetricInfo {
  label: string;
  kind: 'ratio' | 'money' | 'count' | 'share' | 'percent';
  direction: Direction;
}

// Keys are the metric names tools return; the model is told to use the same names.
const METRICS: Record<string, MetricInfo> = {
  roas: { label: 'ROAS', kind: 'ratio', direction: 'higher_is_better' },
  cpi: { label: 'CPI', kind: 'money', direction: 'lower_is_better' },
  spendusd: { label: 'Spend', kind: 'money', direction: 'neutral' },
  spend: { label: 'Spend', kind: 'money', direction: 'neutral' },
  revenueusd: { label: 'Revenue', kind: 'money', direction: 'higher_is_better' },
  revenue: { label: 'Revenue', kind: 'money', direction: 'higher_is_better' },
  installs: { label: 'Installs', kind: 'count', direction: 'higher_is_better' },
  clicks: { label: 'Clicks', kind: 'count', direction: 'neutral' },
  d1retention: { label: 'D1 retention', kind: 'share', direction: 'higher_is_better' },
  d7retention: { label: 'D7 retention', kind: 'share', direction: 'higher_is_better' },
  d7_retention: { label: 'D7 retention', kind: 'share', direction: 'higher_is_better' },
  purchaseevents: { label: 'Purchases', kind: 'count', direction: 'higher_is_better' },
  installdiscrepancypct: { label: 'Install gap vs attribution', kind: 'percent', direction: 'neutral' },
  suspiciousinstallrate: { label: 'Suspicious installs', kind: 'share', direction: 'lower_is_better' },
  avgsuspiciousinstallrate: { label: 'Suspicious installs', kind: 'share', direction: 'lower_is_better' },
};

export function metricInfo(metric: string): MetricInfo {
  return METRICS[metric.toLowerCase().replace(/[\s-]/g, '')] ?? { label: metric, kind: 'ratio', direction: 'neutral' };
}

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Display formatting only; the exact value is always available as a tooltip. */
export function formatMetric(metric: string, value: number | null): string {
  if (value === null) return 'n/a';
  switch (metricInfo(metric).kind) {
    case 'money':
      return money.format(value);
    case 'count':
      return grouped.format(value);
    case 'share':
      // Retention and rates arrive as 0..1; show them as percentages.
      return `${(value <= 1 ? value * 100 : value).toFixed(1)}%`;
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'ratio':
      return value.toFixed(2);
  }
}

export function formatChange(pct: number | null): string {
  if (pct === null) return 'n/a';
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toFixed(1)}%`;
}

export type Sentiment = 'good' | 'bad' | 'neutral';

/** A ROAS drop is bad, a CPI drop is good: colour follows meaning, not sign. */
export function changeSentiment(metric: string, pct: number | null): Sentiment {
  if (pct === null || Math.abs(pct) < 5) return 'neutral';
  const { direction } = metricInfo(metric);
  if (direction === 'neutral') return metric.toLowerCase().includes('discrepancy') && Math.abs(pct) >= 10 ? 'bad' : 'neutral';
  const improved = direction === 'higher_is_better' ? pct > 0 : pct < 0;
  return improved ? 'good' : 'bad';
}

export function formatUsd(n: number): string {
  if (n === 0) return '$0';
  return n < 0.01 ? `$${n.toFixed(4)}` : money.format(n);
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// Plain-language names, plus which system each tool reads: the fragmented sources made visible.
export const TOOL_LABELS: Record<string, { label: string; source: string }> = {
  list_campaigns: { label: 'Listed campaigns', source: 'Internal database' },
  get_campaign_metrics: { label: 'Read campaign metrics', source: 'Internal database' },
  compare_campaign_periods: { label: 'Compared two periods', source: 'Internal database' },
  resolve_campaign_id: { label: 'Matched campaign IDs', source: 'ID mapping table' },
  get_attribution_data: { label: 'Fetched attribution data', source: 'Attribution provider API' },
  get_fraud_signals: { label: 'Checked fraud signals', source: 'Fraud vendor export' },
};

export const toolLabel = (name: string | null) => (name ? (TOOL_LABELS[name]?.label ?? name) : 'Tool');

interface LlmOutput {
  stopReason?: string;
  toolCalls?: { name: string }[];
  errorMessage?: string;
}

export function stepTitle(step: Pick<AgentStep, 'type' | 'toolName' | 'output'>): string {
  if (step.type === 'tool_call') return toolLabel(step.toolName);
  if (step.type === 'repair') return 'Asked the model to fix its answer format';
  const out = (step.output ?? {}) as LlmOutput;
  if (out.stopReason === 'tool_use' && out.toolCalls?.length) {
    return `Model chose: ${out.toolCalls.map((c) => toolLabel(c.name).toLowerCase()).join(', ')}`;
  }
  if (out.stopReason === 'error') return 'Model call failed';
  return 'Model wrote the answer';
}

export const PROVIDER_LABELS: Record<string, string> = { anthropic: 'Claude', nebius: 'Nebius', fake: 'Scripted demo' };
