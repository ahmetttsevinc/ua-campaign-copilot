import type { ReactNode } from 'react';
import { formatMs, formatUsd, toolLabel } from '../lib/format';
import type { RunView } from '../lib/runState';
import { DataTable } from './DataTable';
import { AlertIcon, CheckIcon, InfoIcon, PlayIcon, Spinner, XIcon } from './icons';
import { ProviderBadge } from './ProviderBadge';
import { StatusBadge } from './StatusBadge';

const CONFIDENCE = {
  high: { label: 'High confidence', className: 'text-pos', icon: <CheckIcon size={13} /> },
  medium: { label: 'Medium confidence', className: 'text-muted', icon: <InfoIcon size={13} /> },
  low: { label: 'Low confidence', className: 'text-warn', icon: <AlertIcon size={13} /> },
} as const;

export interface ResumeControl {
  onResume: () => void;
  resuming: boolean;
  error: string | null;
}

function splitValidationError(error: string | null): { reason: string; raw: string | null } {
  const marker = '\n\nRaw model output:\n';
  if (!error) return { reason: 'Unknown error', raw: null };
  const i = error.indexOf(marker);
  return i === -1 ? { reason: error, raw: null } : { reason: error.slice(0, i), raw: error.slice(i + marker.length) };
}

/** One row of metadata; items separated by hairlines rather than punctuation. */
function Meta({ children }: { children: ReactNode[] }) {
  return (
    <div className="flex flex-wrap items-center gap-y-1 text-xs text-muted">
      {children.filter(Boolean).map((c, i) => (
        <span key={i} className="flex items-center border-rule px-3 first:pl-0 [&:not(:first-child)]:border-l">
          {c}
        </span>
      ))}
    </div>
  );
}

function Notice({ tone, icon, title, children, testId }: { tone: 'neg' | 'warn'; icon: ReactNode; title: string; children?: ReactNode; testId: string }) {
  const styles = tone === 'neg' ? 'border-neg/30 bg-neg-wash' : 'border-warn/30 bg-warn-wash';
  return (
    <div data-testid={testId} className={`rounded-lg border p-4 ${styles}`}>
      <div className="flex gap-3">
        <span className={`mt-0.5 shrink-0 ${tone === 'neg' ? 'text-neg' : 'text-warn'}`}>{icon}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-semibold">{title}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function ResumeButton({ run, resume }: { run: RunView; resume: ResumeControl | undefined }) {
  if (!run.resumable || !resume) return null;
  const last = run.steps.at(-1)?.stepNumber ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <button
        type="button"
        data-testid="resume-run"
        onClick={resume.onResume}
        disabled={resume.resuming}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-ink hover:brightness-110 disabled:opacity-60"
      >
        {resume.resuming ? <Spinner size={13} /> : <PlayIcon size={12} />}
        <span>{resume.resuming ? 'Resuming…' : last > 0 ? `Resume from step ${last + 1}` : 'Resume'}</span>
      </button>
      <span className="text-xs text-muted">Completed steps are kept and will not run again.</span>
      {resume.error && (
        <span role="alert" data-testid="resume-error" className="text-xs text-neg">
          {resume.error}
        </span>
      )}
    </div>
  );
}

function Running({ run }: { run: RunView }) {
  const done = run.steps.length;
  const current = run.inFlight.at(-1);
  const now = current ? (current.stepType === 'tool_call' ? toolLabel(current.toolName) : current.stepType === 'repair' ? 'Fixing the answer format' : 'Model is deciding the next step') : 'Reading the question';
  return (
    <div className="space-y-5">
      <p data-testid="answer-running" className="flex items-center gap-2 text-muted">
        <Spinner size={14} className="text-accent" />
        <span>
          Working on it. {done === 0 ? '' : `${done} ${done === 1 ? 'step' : 'steps'} done; `}now: <span className="text-ink">{now.toLowerCase()}</span>
        </span>
      </p>
      <div className="space-y-2" aria-hidden>
        <div className="skeleton h-3.5 w-11/12" />
        <div className="skeleton h-3.5 w-4/5" />
        <div className="skeleton h-3.5 w-2/3" />
      </div>
      <div className="skeleton h-24 w-full" aria-hidden />
    </div>
  );
}

function Body({ run, resume }: { run: RunView; resume?: ResumeControl | undefined }) {
  switch (run.status) {
    case 'running':
      return <Running run={run} />;
    case 'completed': {
      const a = run.finalAnswer;
      if (!a) return <p className="text-neg">This run finished without an answer.</p>;
      return (
        <div className="space-y-7">
          <p data-testid="answer-summary" className="max-w-[80ch] text-[15px] leading-[1.65] text-ink">
            {a.summary}
          </p>
          <section aria-labelledby="findings-heading" className="space-y-2.5">
            <h3 id="findings-heading" className="flex items-baseline gap-2 text-[13px] font-semibold">
              What changed
              <span className="num text-xs font-normal text-faint">{a.findings.length}</span>
            </h3>
            <DataTable findings={a.findings} />
          </section>
          {a.caveats.length > 0 && (
            <section aria-labelledby="caveats-heading" className="rounded-lg border border-warn/25 bg-warn-wash/60 px-4 py-3">
              <h3 id="caveats-heading" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-warn">
                <AlertIcon size={13} />
                Keep in mind
              </h3>
              <ul data-testid="caveats" className="max-w-[90ch] list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink/85 marker:text-warn">
                {a.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      );
    }
    case 'failed_validation': {
      const { reason, raw } = splitValidationError(run.error);
      return (
        <Notice testId="validation-warning" tone="warn" icon={<AlertIcon />} title="The model's answer did not pass validation, so it is not shown as an answer.">
          <p className="text-[13px] text-muted">{reason}</p>
          {raw && (
            <details>
              <summary className="cursor-pointer text-[13px] font-medium">Show what the model wrote</summary>
              <pre data-testid="validation-raw" className="num mt-2 max-h-72 overflow-auto rounded-md border border-rule bg-surface p-3 text-xs whitespace-pre-wrap">
                {raw}
              </pre>
            </details>
          )}
        </Notice>
      );
    }
    case 'failed':
      return (
        <Notice testId="run-error" tone="neg" icon={<XIcon />} title="This run stopped before it could answer.">
          <p className="num text-xs break-words text-ink/80">{run.error}</p>
          <ResumeButton run={run} resume={resume} />
        </Notice>
      );
    case 'budget_exceeded':
    case 'max_steps_exceeded':
      return (
        <Notice testId="run-error" tone="warn" icon={<AlertIcon />} title="This run hit its limit before answering.">
          <p className="num text-xs text-ink/80">{run.error}</p>
          <p className="text-[13px] text-muted">Try a narrower question, for example one campaign or one metric.</p>
        </Notice>
      );
  }
}

export function AnswerCard({ run, resume }: { run: RunView; resume?: ResumeControl }) {
  const confidence = run.status === 'completed' && run.finalAnswer ? CONFIDENCE[run.finalAnswer.confidence] : null;
  return (
    <article data-testid="answer-card" data-status={run.status} className="space-y-6">
      <header className="space-y-2.5 border-b border-rule pb-4">
        <h2 className="text-xl leading-snug font-semibold tracking-tight text-balance">{run.question}</h2>
        <Meta>
          {[
            <StatusBadge key="s" status={run.status} />,
            confidence && run.finalAnswer ? (
              <span key="c" data-testid="confidence-badge" data-confidence={run.finalAnswer.confidence} className={`inline-flex items-center gap-1 font-medium ${confidence.className}`}>
                {confidence.icon}
                {confidence.label}
              </span>
            ) : null,
            <ProviderBadge key="p" provider={run.provider} model={run.model} />,
            <span key="v" className="num" title="Prompt version">
              prompt {run.promptVersion}
            </span>,
            <span key="$" className="num" title="Total cost">
              {formatUsd(run.totalCostUsd)}
            </span>,
            run.status === 'running' ? null : (
              <span key="t" className="num" title="Active time">
                {formatMs(run.totalLatencyMs)}
              </span>
            ),
          ]}
        </Meta>
      </header>
      <Body run={run} resume={resume} />
    </article>
  );
}
