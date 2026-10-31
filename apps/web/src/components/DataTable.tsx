import type { Finding } from '@copilot/shared';
import { changeSentiment, formatChange, formatMetric, metricInfo } from '../lib/format';
import { parseStepRef, useEvidence } from '../lib/evidence';

const SENTIMENT_CLASS = { good: 'text-good', bad: 'text-bad', neutral: 'text-ink' } as const;

function EvidenceLinks({ refs }: { refs: string[] }) {
  const { setHighlighted, focus } = useEvidence();
  return (
    <span className="flex flex-wrap gap-1">
      {refs.map((ref) => {
        const step = parseStepRef(ref);
        if (step === null) return <span key={ref} className="text-xs text-muted">{ref}</span>;
        return (
          <button
            key={ref}
            type="button"
            data-testid="evidence-link"
            data-step={step}
            title={`Show step ${step} in the trace`}
            onMouseEnter={() => setHighlighted(step)}
            onMouseLeave={() => setHighlighted(null)}
            onFocus={() => setHighlighted(step)}
            onBlur={() => setHighlighted(null)}
            onClick={() => focus(step)}
            className="tabular rounded-sm bg-cobalt-wash px-1.5 py-px text-xs font-medium text-cobalt hover:bg-cobalt hover:text-surface"
          >
            step {step}
          </button>
        );
      })}
    </span>
  );
}

export function DataTable({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <p data-testid="findings-empty" className="text-sm text-muted">
        Nothing unusual to report for this question.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table data-testid="findings-table" className="w-full border-collapse text-sm">
        <caption className="sr-only">Findings with before and after values</caption>
        <thead>
          <tr className="border-b border-ink text-left text-xs text-muted">
            <th scope="col" className="py-2 pr-4 font-medium">Campaign</th>
            <th scope="col" className="py-2 pr-4 font-medium">Metric</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Before</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">After</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Change</th>
            <th scope="col" className="py-2 pr-4 font-medium">Likely cause</th>
            <th scope="col" className="py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f, i) => {
            const sentiment = changeSentiment(f.metric, f.changePct);
            return (
              <tr key={`${f.campaignId}-${f.metric}-${i}`} data-testid="finding-row" className="border-b border-rule align-top">
                <td className="py-3 pr-4">
                  <div className="font-medium">{f.campaignName}</div>
                  <div className="text-xs text-muted">{f.campaignId}</div>
                </td>
                <td className="py-3 pr-4 whitespace-nowrap">{metricInfo(f.metric).label}</td>
                <td className="tabular py-3 pr-4 text-right whitespace-nowrap" title={String(f.before ?? '')}>
                  {formatMetric(f.metric, f.before)}
                </td>
                <td className="tabular py-3 pr-4 text-right whitespace-nowrap" title={String(f.after ?? '')}>
                  {formatMetric(f.metric, f.after)}
                </td>
                <td
                  data-testid="finding-change"
                  data-sentiment={sentiment}
                  className={`tabular py-3 pr-4 text-right font-semibold whitespace-nowrap ${SENTIMENT_CLASS[sentiment]}`}
                >
                  {formatChange(f.changePct)}
                </td>
                <td className="max-w-md py-3 pr-4 leading-relaxed">{f.likelyCause}</td>
                <td className="py-3">
                  <EvidenceLinks refs={f.evidence} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
