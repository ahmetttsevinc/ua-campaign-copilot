import type { Finding } from '@copilot/shared';
import { useState } from 'react';
import { parseStepRef, useEvidence } from '../lib/evidence';
import { causeHeadline, changeSentiment, formatChange, formatMetric, metricInfo, type Sentiment } from '../lib/format';
import { ArrowDownIcon, ArrowRightIcon, ArrowUpIcon, ChevronIcon } from './icons';

const TONE: Record<Sentiment, string> = { good: 'text-pos', bad: 'text-neg', neutral: 'text-ink' };
const BAR: Record<Sentiment, string> = { good: 'bg-pos', bad: 'bg-neg', neutral: 'bg-muted' };
const SENTIMENT_TEXT: Record<Sentiment, string> = { good: 'improvement', bad: 'deterioration', neutral: 'no material change' };

/** Before vs after as two hairline bars on a shared scale: the size of the move at a glance. */
function MiniBars({ before, after, sentiment }: { before: number; after: number; sentiment: Sentiment }) {
  const max = Math.max(Math.abs(before), Math.abs(after));
  if (max === 0 || before < 0 || after < 0) return null;
  return (
    <span className="mt-1.5 block w-full max-w-36 space-y-[3px]" aria-hidden>
      <span className="block h-[3px] rounded-full bg-rule-strong" style={{ width: `${(before / max) * 100}%` }} />
      <span className={`block h-[3px] rounded-full ${BAR[sentiment]}`} style={{ width: `${(after / max) * 100}%` }} />
    </span>
  );
}

function EvidenceLinks({ refs }: { refs: string[] }) {
  const { setHighlighted, focus } = useEvidence();
  return (
    <span className="flex flex-wrap gap-1">
      {refs.map((ref) => {
        const step = parseStepRef(ref);
        if (step === null) return <span key={ref} className="text-xs text-faint">{ref}</span>;
        return (
          <button
            key={ref}
            type="button"
            data-testid="evidence-link"
            data-step={step}
            title={`Show step ${step} in the trace`}
            aria-label={`Show step ${step} in the trace`}
            onMouseEnter={() => setHighlighted(step)}
            onMouseLeave={() => setHighlighted(null)}
            onFocus={() => setHighlighted(step)}
            onBlur={() => setHighlighted(null)}
            onClick={() => focus(step)}
            className="num rounded border border-accent/25 bg-accent-wash px-1.5 py-px text-[11px] font-medium text-accent transition-colors hover:border-accent hover:bg-accent hover:text-accent-ink"
          >
            step {step}
          </button>
        );
      })}
    </span>
  );
}

function Cause({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const { headline, hasMore } = causeHeadline(text);
  return (
    <div className="min-w-0">
      <p className={open ? 'leading-relaxed' : 'line-clamp-2 leading-snug'} title={open ? undefined : text}>
        {open ? text : headline}
      </p>
      {hasMore && (
        <button
          type="button"
          data-testid="finding-expand"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium text-muted hover:text-ink"
        >
          <ChevronIcon size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          {open ? 'Less' : 'Full explanation'}
        </button>
      )}
    </div>
  );
}

// One responsive grid instead of a <table>: wide containers get six columns, narrow ones a
// compact card per finding (campaign + change first), without duplicating rows in the DOM.
const ROW =
  'grid gap-x-4 gap-y-2 px-3.5 py-3 [grid-template-areas:"campaign_change""metric_numbers""cause_cause""evidence_evidence"] grid-cols-[minmax(0,1fr)_auto] ' +
  '@[46rem]:[grid-template-areas:"campaign_metric_numbers_change_cause_evidence"] @[46rem]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.5fr)_minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1.8fr)_minmax(0,1.05fr)] @[46rem]:gap-y-0';

export function DataTable({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <p data-testid="findings-empty" className="rounded-md border border-dashed border-rule-strong px-4 py-3 text-muted">
        Nothing unusual to report for this question.
      </p>
    );
  }
  return (
    <div className="@container">
      <div data-testid="findings-table" role="table" aria-label="Findings with before and after values" className="overflow-hidden rounded-lg border border-rule bg-surface text-[13px]">
        <div role="row" className={`${ROW} hidden border-b border-rule py-2 text-xs text-muted @[46rem]:grid`}>
          <span role="columnheader" className="[grid-area:campaign]">Campaign</span>
          <span role="columnheader" className="[grid-area:metric]">Metric</span>
          <span role="columnheader" className="[grid-area:numbers]">Before → after</span>
          <span role="columnheader" className="text-right [grid-area:change]">Change</span>
          <span role="columnheader" className="[grid-area:cause]">Likely cause</span>
          <span role="columnheader" className="[grid-area:evidence]">Evidence</span>
        </div>
        {findings.map((f, i) => {
          const sentiment = changeSentiment(f.metric, f.changePct);
          const Arrow = f.changePct === null || f.changePct === 0 ? null : f.changePct > 0 ? ArrowUpIcon : ArrowDownIcon;
          return (
            <div role="row" key={`${f.campaignId}-${f.metric}-${i}`} data-testid="finding-row" className={`${ROW} items-start border-b border-rule last:border-b-0`}>
              <div role="cell" className="min-w-0 [grid-area:campaign]">
                <div className="line-clamp-2 leading-snug font-medium" title={f.campaignName}>{f.campaignName}</div>
                <div className="num mt-0.5 text-xs text-muted">{f.campaignId}</div>
              </div>
              <div role="cell" className="text-muted [grid-area:metric]">{metricInfo(f.metric).label}</div>
              <div role="cell" className="min-w-0 [grid-area:numbers]">
                <div className="num flex items-center gap-1.5 whitespace-nowrap">
                  <span className="text-muted" title={String(f.before ?? '')}>{formatMetric(f.metric, f.before)}</span>
                  <ArrowRightIcon size={12} className="shrink-0 text-faint" />
                  <span className="font-medium" title={String(f.after ?? '')}>{formatMetric(f.metric, f.after)}</span>
                </div>
                {f.before !== null && f.after !== null && <MiniBars before={f.before} after={f.after} sentiment={sentiment} />}
              </div>
              <div role="cell" className={`text-right [grid-area:change] ${TONE[sentiment]}`}>
                <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap" title={SENTIMENT_TEXT[sentiment]}>
                  {Arrow && <Arrow size={14} />}
                  <span data-testid="finding-change" data-sentiment={sentiment} className="num text-[15px] font-semibold">
                    {formatChange(f.changePct)}
                  </span>
                </span>
                <span className="sr-only">{SENTIMENT_TEXT[sentiment]}</span>
              </div>
              <div role="cell" className="min-w-0 [grid-area:cause]">
                <Cause text={f.likelyCause} />
              </div>
              <div role="cell" className="[grid-area:evidence]">
                <EvidenceLinks refs={f.evidence} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
