import type { AgentStep } from '@copilot/shared';
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { parseStepRef, useEvidence } from '../lib/evidence';
import { formatMs, formatTokens, formatUsd, SOURCE_LABELS, type SourceKind, stepTitle, TOOL_LABELS, toolLabel } from '../lib/format';
import { highlightJson } from '../lib/json';
import type { InFlightStep, RunView } from '../lib/runState';
import { ChevronIcon, DatabaseIcon, GlobeIcon, LinkIcon, RetryIcon, ShieldIcon, SparkIcon, Spinner, WrenchIcon, XIcon } from './icons';

const SOURCE_ICON: Record<SourceKind, (p: { size?: number }) => ReactNode> = {
  internal: DatabaseIcon,
  attribution: GlobeIcon,
  fraud: ShieldIcon,
  mapping: LinkIcon,
};

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

function resumedAfter(step: AgentStep): number | null {
  const n = (step.input as { resumedAfterStep?: unknown } | null)?.resumedAfterStep;
  return typeof n === 'number' ? n : null;
}

/** Timeline node: round for model steps, square for data sources, so the two read differently at a glance. */
function Node({ step }: { step: AgentStep }) {
  const base = 'relative z-10 flex size-[22px] shrink-0 items-center justify-center border';
  if (step.isError && step.type !== 'repair') return <span className={`${base} rounded-full border-neg/40 bg-neg-wash text-neg`}><XIcon size={12} /></span>;
  if (step.type === 'llm_call') return <span className={`${base} rounded-full border-accent/30 bg-accent-wash text-accent`}><SparkIcon size={12} /></span>;
  if (step.type === 'repair') return <span className={`${base} rounded-full border-warn/40 bg-warn-wash text-warn`}><WrenchIcon size={12} /></span>;
  const kind = step.toolName ? TOOL_LABELS[step.toolName]?.kind : undefined;
  const Icon = kind ? SOURCE_ICON[kind] : DatabaseIcon;
  return <span className={`${base} rounded-[5px] border-rule-strong bg-surface text-muted`}><Icon size={12} /></span>;
}

function Badge({ tone, children, testId, title }: { tone: 'neg' | 'warn' | 'accent' | 'plain'; children: ReactNode; testId?: string; title?: string }) {
  const styles = { neg: 'bg-neg-wash text-neg', warn: 'bg-warn-wash text-warn', accent: 'bg-accent-wash text-accent', plain: 'bg-sunken text-muted' }[tone];
  return (
    <span data-testid={testId} title={title} className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium ${styles}`}>
      {children}
    </span>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-faint">{label}</div>
      <pre className="num max-h-64 overflow-auto rounded-md border border-rule bg-sunken p-2 text-[11px] leading-[1.45] whitespace-pre-wrap text-ink">{highlightJson(value)}</pre>
    </div>
  );
}

function StepRow({ step, cited, animate }: { step: AgentStep; cited: boolean; animate: boolean }) {
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
  const kind = step.type === 'tool_call' && step.toolName ? TOOL_LABELS[step.toolName]?.kind : undefined;
  const SourceIcon = kind ? SOURCE_ICON[kind] : null;

  return (
    <li
      ref={ref}
      key={flash}
      data-testid="trace-step"
      data-step-number={step.stepNumber}
      data-step-type={step.type}
      data-highlighted={isHighlighted || undefined}
      className={`relative rounded-md px-2 py-2 transition-colors ${isHighlighted ? 'bg-accent-wash shadow-[inset_0_0_0_1px_var(--accent)]' : 'hover:bg-sunken/60'} ${flash ? 'provenance-flash' : ''} ${animate ? 'step-enter' : ''}`}
    >
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none gap-2.5 [&::-webkit-details-marker]:hidden">
          <Node step={step} />
          <span className="min-w-0 flex-1">
            <span className="flex items-start gap-2">
              <span className="flex-1 text-[13px] leading-snug font-medium">{stepTitle(step)}</span>
              <span className="num pt-px text-[11px] text-faint">#{step.stepNumber}</span>
              <ChevronIcon size={12} className={`mt-0.5 shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
              {SourceIcon && kind && (
                <Badge tone="plain">
                  <SourceIcon size={11} />
                  {SOURCE_LABELS[kind]}
                </Badge>
              )}
              {step.type === 'llm_call' && <Badge tone="accent">Model</Badge>}
              <span className="num">{formatMs(step.latencyMs)}</span>
              {step.type === 'llm_call' && (
                <span className="num" title={`${step.inputTokens} input, ${step.outputTokens} output tokens`}>
                  {formatTokens(step.inputTokens)}/{formatTokens(step.outputTokens)} tok {formatUsd(step.costUsd)}
                </span>
              )}
              {step.isError && step.type !== 'repair' && (
                <Badge tone="neg" testId="step-error-badge">
                  Error
                </Badge>
              )}
              {step.type === 'repair' && <Badge tone="warn">Repair</Badge>}
              {retries > 0 && (
                <Badge tone="warn" testId="step-retry-badge">
                  <RetryIcon size={10} />
                  {`Retried ${retries}×`}
                </Badge>
              )}
              {cited && (
                <Badge tone="accent" title="A finding in the answer cites this step">
                  <LinkIcon size={10} />
                  Cited
                </Badge>
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

function ResumeDivider({ after }: { after: number }) {
  return (
    <li data-testid="resume-divider" className="flex items-center gap-2 py-1.5 pl-1 text-[11px] font-medium text-accent">
      <span className="h-px w-3 bg-accent/40" aria-hidden />
      Resumed after step {after}. Steps above were kept, not run again.
      <span className="h-px flex-1 bg-accent/40" aria-hidden />
    </li>
  );
}

function InFlightRow({ s }: { s: InFlightStep }) {
  const what = s.stepType === 'tool_call' ? toolLabel(s.toolName) : s.stepType === 'repair' ? 'Fixing answer format' : 'Model is thinking';
  return (
    <li data-testid="trace-step-inflight" className="step-enter flex items-center gap-2.5 px-2 py-2 text-[13px] text-muted">
      <span className="relative z-10 flex size-[22px] items-center justify-center rounded-full border border-accent/30 bg-surface text-accent">
        <Spinner size={12} />
      </span>
      <span className="flex-1">{what}…</span>
      <span className="num text-[11px] text-faint">#{s.stepNumber}</span>
    </li>
  );
}

function Totals({ run }: { run: RunView }) {
  const cell = (label: string, value: ReactNode, testId?: string) => (
    <div>
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd data-testid={testId} className="num text-[13px] font-medium">
        {value}
      </dd>
    </div>
  );
  return (
    <dl data-testid="trace-totals" className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-rule bg-surface px-4 py-3">
      {cell('Steps', run.steps.length)}
      {cell('Cost', formatUsd(run.totalCostUsd), 'total-cost')}
      {cell('Time', run.status === 'running' ? '…' : formatMs(run.totalLatencyMs))}
      {cell('Tokens', `${formatTokens(run.totalInputTokens)} / ${formatTokens(run.totalOutputTokens)}`)}
      {cell('Retries', run.retries)}
      {cell('Repairs', run.repairs)}
    </dl>
  );
}

export function StepTrace({ run }: { run: RunView | undefined }) {
  const cited = useMemo(
    () => new Set((run?.finalAnswer?.findings ?? []).flatMap((f) => f.evidence.map(parseStepRef)).filter((n): n is number => n !== null)),
    [run?.finalAnswer],
  );
  return (
    <section aria-labelledby="trace-heading" className="flex h-full min-h-0 flex-col">
      <div className="border-b border-rule px-4 py-3">
        <h2 id="trace-heading" className="text-[13px] font-semibold">
          How this answer was built
        </h2>
        <p className="mt-0.5 text-xs text-muted">Each step, the system it read, and what it cost.</p>
      </div>

      {!run ? (
        <div className="space-y-3 px-4 py-5 text-[13px] text-muted">
          <p>Ask a question to see the copilot work step by step.</p>
          <ul className="space-y-2 text-xs">
            <li className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-accent-wash text-accent"><SparkIcon size={11} /></span>Model step: decides what to look up</li>
            <li className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-[5px] border border-rule-strong text-muted"><DatabaseIcon size={11} /></span>Data step: reads one source system</li>
          </ul>
        </div>
      ) : (
        <>
          <div className="relative min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {/* The timeline spine runs behind the step nodes. */}
            <span className="absolute top-4 bottom-4 left-[20px] w-px bg-rule" aria-hidden />
            <ol data-testid="step-trace" aria-live="polite" className="relative space-y-0.5">
              {run.steps.map((s) => {
                const after = resumedAfter(s);
                return (
                  <Fragment key={s.stepNumber}>
                    {after !== null && <ResumeDivider after={after} />}
                    <StepRow step={s} cited={cited.has(s.stepNumber)} animate={run.status === 'running'} />
                  </Fragment>
                );
              })}
              {run.status === 'running' &&
                run.inFlight.filter((f) => !run.steps.some((s) => s.stepNumber === f.stepNumber)).map((s) => <InFlightRow key={`f${s.stepNumber}`} s={s} />)}
            </ol>
          </div>
          <Totals run={run} />
        </>
      )}
    </section>
  );
}
