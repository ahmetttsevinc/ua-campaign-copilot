import type { RunView } from '../lib/runState';
import { DataTable } from './DataTable';
import { ProviderBadge } from './ProviderBadge';
import { StatusBadge } from './StatusBadge';

const CONFIDENCE = {
  high: { label: 'High confidence', className: 'bg-good-wash text-good' },
  medium: { label: 'Medium confidence', className: 'bg-caution-wash text-caution' },
  low: { label: 'Low confidence', className: 'bg-bad-wash text-bad' },
} as const;

function splitValidationError(error: string | null): { reason: string; raw: string | null } {
  const marker = '\n\nRaw model output:\n';
  if (!error) return { reason: 'Unknown error', raw: null };
  const i = error.indexOf(marker);
  return i === -1 ? { reason: error, raw: null } : { reason: error.slice(0, i), raw: error.slice(i + marker.length) };
}

export interface ResumeControl {
  onResume: () => void;
  resuming: boolean;
  error: string | null;
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
        className="rounded-sm bg-ink px-3 py-1.5 text-sm font-semibold text-surface disabled:opacity-50"
      >
        {resume.resuming ? 'Resuming…' : last > 0 ? `Resume from step ${last + 1}` : 'Resume'}
      </button>
      <span className="text-sm text-muted">Completed steps are kept and will not run again.</span>
      {resume.error && (
        <span role="alert" data-testid="resume-error" className="text-sm text-bad">
          {resume.error}
        </span>
      )}
    </div>
  );
}

function Body({ run, resume }: { run: RunView; resume?: ResumeControl | undefined }) {
  switch (run.status) {
    case 'running': {
      const done = run.steps.length;
      return (
        <p data-testid="answer-running" className="flex items-center gap-2 text-muted">
          <span className="working-dot inline-block size-2 rounded-full bg-cobalt" aria-hidden />
          Working on it. {done === 0 ? 'Reading the question…' : `${done} ${done === 1 ? 'step' : 'steps'} done so far; follow along on the right.`}
        </p>
      );
    }
    case 'completed': {
      const a = run.finalAnswer;
      if (!a) return <p className="text-bad">This run finished without an answer.</p>;
      return (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <span data-testid="confidence-badge" data-confidence={a.confidence} className={`rounded-sm px-1.5 py-px text-xs font-medium ${CONFIDENCE[a.confidence].className}`}>
              {CONFIDENCE[a.confidence].label}
            </span>
          </div>
          <p data-testid="answer-summary" className="max-w-[66ch] font-serif text-[1.075rem] leading-[1.65] text-ink">
            {a.summary}
          </p>
          <DataTable findings={a.findings} />
          {a.caveats.length > 0 && (
            <section aria-labelledby="caveats-heading" className="max-w-[72ch]">
              <h3 id="caveats-heading" className="mb-2 text-sm font-semibold">
                Keep in mind
              </h3>
              <ul data-testid="caveats" className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
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
        <div data-testid="validation-warning" className="space-y-3 border-l-4 border-caution bg-caution-wash p-4">
          <p className="font-medium">The model's answer did not pass validation, so it is not shown as an answer.</p>
          <p className="text-sm text-muted">{reason}</p>
          {raw && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">Show what the model wrote</summary>
              <pre data-testid="validation-raw" className="mt-2 max-h-72 overflow-auto bg-surface p-3 text-xs whitespace-pre-wrap">
                {raw}
              </pre>
            </details>
          )}
        </div>
      );
    }
    case 'failed':
      return (
        <div data-testid="run-error" className="space-y-2 border-l-4 border-bad bg-bad-wash p-4">
          <p className="font-medium">This run stopped before it could answer.</p>
          <p className="text-sm break-words">{run.error}</p>
          <ResumeButton run={run} resume={resume} />
        </div>
      );
    case 'budget_exceeded':
    case 'max_steps_exceeded':
      return (
        <div data-testid="run-error" className="space-y-2 border-l-4 border-caution bg-caution-wash p-4">
          <p className="font-medium">This run hit its limit before answering.</p>
          <p className="text-sm">{run.error} Try a narrower question, for example one campaign or one metric.</p>
        </div>
      );
  }
}

export function AnswerCard({ run, resume }: { run: RunView; resume?: ResumeControl }) {
  return (
    <article data-testid="answer-card" data-status={run.status} className="space-y-5">
      <header className="space-y-2 border-b border-rule pb-4">
        <h2 className="text-xl leading-snug font-semibold tracking-tight">{run.question}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={run.status} />
          <ProviderBadge provider={run.provider} model={run.model} />
          <span className="text-xs text-muted">prompt {run.promptVersion}</span>
        </div>
      </header>
      <Body run={run} resume={resume} />
    </article>
  );
}
