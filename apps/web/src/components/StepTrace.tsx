import type { AgentStep } from '@copilot/shared';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useEvidence } from '../lib/evidence';
import { formatMs, formatTokens, formatUsd, stepTitle, TOOL_LABELS, toolLabel } from '../lib/format';
import type { InFlightStep, RunView } from '../lib/runState';

/** Strip the provider-only replay blob (e.g. Claude thinking signatures): noise for a human. */
function displayable(step: AgentStep): { input: unknown; output: unknown } {
  if (step.type === 'llm_call') {
    const { providerState: _p, raw: _r, ...out } = (step.output ?? {}) as Record<string, unknown>;
    return { input: step.input, output: out };
  }
  if (step.type === 'tool_call') {
    const out = (step.output ?? {}) as { ok?: boolean; output?: unknown; error?: unknown };
    return { input: (step.input as { input?: unknown })?.input, output: out.ok ? out.output : { error: out.error } };
  }
  return { input: step.input, output: step.output };
}

function retriesOf(step: AgentStep): number {
  return step.type === 'llm_call' ? Number((step.input as { retries?: number } | null)?.retries ?? 0) : 0;
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{label}</div>
      <pre className="max-h-64 overflow-auto rounded-sm bg-paper p-2 text-[11px] leading-snug whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function StepRow({ step }: { step: AgentStep }) {
  const { highlighted, focused } = useEvidence();
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(0);
  const ref = useRef<HTMLLIElement>(null);
  const isHighlighted = highlighted === step.stepNumber;

  useEffect(() => {
    if (focused?.step !== step.stepNumber) return;
    setOpen(true);
    setFlash(focused.nonce);
    ref.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  }, [focused, step.stepNumber]);

  const { input, output } = displayable(step);
  const retries = retriesOf(step);
  const source = step.type === 'tool_call' && step.toolName ? TOOL_LABELS[step.toolName]?.source : step.type === 'llm_call' ? 'Language model' : undefined;

  return (
    <li
      ref={ref}
      key={flash}
      data-testid="trace-step"
      data-step-number={step.stepNumber}
      data-step-type={step.type}
      data-highlighted={isHighlighted || undefined}
      className={`border-l-2 py-2.5 pr-3 pl-3 ${isHighlighted ? 'border-l-cobalt bg-cobalt-wash' : 'border-l-transparent'} ${flash ? 'provenance-flash' : ''}`}
    >
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none gap-3 [&::-webkit-details-marker]:hidden">
          <span className="tabular w-5 shrink-0 pt-px text-right text-xs text-muted">{step.stepNumber}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm leading-snug font-medium">{stepTitle(step)}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {source && <span>{source}</span>}
              <span className="tabular">{formatMs(step.latencyMs)}</span>
              {step.type === 'llm_call' && (
                <span className="tabular" title={`${step.inputTokens} input, ${step.outputTokens} output tokens`}>
                  {formatTokens(step.inputTokens)} in, {formatTokens(step.outputTokens)} out, {formatUsd(step.costUsd)}
                </span>
              )}
              {step.isError && step.type !== 'repair' && (
                <span data-testid="step-error-badge" className="rounded-sm bg-bad-wash px-1 text-bad">
                  Error
                </span>
              )}
              {step.type === 'repair' && <span className="rounded-sm bg-caution-wash px-1 text-caution">Repair</span>}
              {retries > 0 && (
                <span data-testid="step-retry-badge" className="rounded-sm bg-caution-wash px-1 text-caution">
                  Retried {retries}×
                </span>
              )}
            </span>
          </span>
        </summary>
        <div className="mt-2 ml-8 space-y-2">
          <Json label="Input" value={input} />
          <Json label="Output" value={output} />
        </div>
      </details>
    </li>
  );
}

function resumedAfter(step: AgentStep): number | null {
  const n = (step.input as { resumedAfterStep?: unknown } | null)?.resumedAfterStep;
  return typeof n === 'number' ? n : null;
}

function ResumeDivider({ after }: { after: number }) {
  return (
    <li data-testid="resume-divider" className="flex items-center gap-2 bg-paper px-3 py-1.5 text-xs text-muted">
      <span className="h-px flex-1 bg-rule" aria-hidden />
      Resumed after step {after}. Steps above were kept, not run again.
      <span className="h-px flex-1 bg-rule" aria-hidden />
    </li>
  );
}

function InFlightRow({ s }: { s: InFlightStep }) {
  const what = s.stepType === 'tool_call' ? toolLabel(s.toolName) : s.stepType === 'repair' ? 'Fixing answer format' : 'Model is thinking';
  return (
    <li data-testid="trace-step-inflight" className="flex gap-3 border-l-2 border-l-transparent py-2.5 pr-3 pl-3 text-sm text-muted">
      <span className="tabular w-5 shrink-0 text-right text-xs">{s.stepNumber}</span>
      <span className="flex items-center gap-2">
        <span className="working-dot inline-block size-1.5 rounded-full bg-cobalt" aria-hidden />
        {what}…
      </span>
    </li>
  );
}

export function StepTrace({ run }: { run: RunView | undefined }) {
  return (
    <section aria-labelledby="trace-heading" className="flex h-full flex-col">
      <div className="border-b border-rule px-4 py-3">
        <h2 id="trace-heading" className="text-sm font-semibold">
          How this answer was built
        </h2>
        <p className="mt-0.5 text-xs text-muted">Every number in the answer comes from one of these steps.</p>
      </div>

      {!run ? (
        <p className="px-4 py-6 text-sm text-muted">Ask a question to see each step the copilot takes, which system it reads, and what it costs.</p>
      ) : (
        <>
          <ol data-testid="step-trace" aria-live="polite" className="flex-1 divide-y divide-rule/70 overflow-y-auto">
            {run.steps.map((s) => {
              const after = resumedAfter(s);
              return (
                <Fragment key={s.stepNumber}>
                  {after !== null && <ResumeDivider after={after} />}
                  <StepRow step={s} />
                </Fragment>
              );
            })}
            {run.status === 'running' && run.inFlight.filter((f) => !run.steps.some((s) => s.stepNumber === f.stepNumber)).map((s) => <InFlightRow key={`f${s.stepNumber}`} s={s} />)}
          </ol>
          <dl data-testid="trace-totals" className="tabular grid grid-cols-3 gap-x-3 gap-y-2 border-t border-ink px-4 py-3 text-xs">
            <div>
              <dt className="text-muted">Steps</dt>
              <dd className="text-sm font-semibold">{run.steps.length}</dd>
            </div>
            <div>
              <dt className="text-muted">Cost</dt>
              <dd data-testid="total-cost" className="text-sm font-semibold">{formatUsd(run.totalCostUsd)}</dd>
            </div>
            <div>
              <dt className="text-muted">Time</dt>
              <dd className="text-sm font-semibold">{run.status === 'running' ? '…' : formatMs(run.totalLatencyMs)}</dd>
            </div>
            <div>
              <dt className="text-muted">Tokens</dt>
              <dd>
                {formatTokens(run.totalInputTokens)} in, {formatTokens(run.totalOutputTokens)} out
              </dd>
            </div>
            <div>
              <dt className="text-muted">Retries</dt>
              <dd>{run.retries}</dd>
            </div>
            <div>
              <dt className="text-muted">Repairs</dt>
              <dd>{run.repairs}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
