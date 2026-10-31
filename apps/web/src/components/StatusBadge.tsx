import type { RunStatus } from '@copilot/shared';
import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon, Spinner, XIcon } from './icons';

const STATUS: Record<RunStatus, { label: string; tone: string; icon: ReactNode }> = {
  running: { label: 'Running', tone: 'text-accent', icon: <Spinner size={12} /> },
  completed: { label: 'Answered', tone: 'text-pos', icon: <CheckIcon size={13} /> },
  failed: { label: 'Failed', tone: 'text-neg', icon: <XIcon size={13} /> },
  failed_validation: { label: 'Invalid answer', tone: 'text-warn', icon: <AlertIcon size={13} /> },
  budget_exceeded: { label: 'Over budget', tone: 'text-warn', icon: <AlertIcon size={13} /> },
  max_steps_exceeded: { label: 'Too many steps', tone: 'text-warn', icon: <AlertIcon size={13} /> },
};

/** Icon + label, never colour alone. `quiet` drops the label for the common, healthy case. */
export function StatusBadge({ status, quiet = false }: { status: RunStatus; quiet?: boolean }) {
  const s = STATUS[status];
  const hideLabel = quiet && status === 'completed';
  return (
    <span data-testid="status-badge" data-status={status} title={s.label} className={`inline-flex items-center gap-1 text-xs font-medium ${s.tone}`}>
      {s.icon}
      <span className={hideLabel ? 'sr-only' : ''}>{s.label}</span>
    </span>
  );
}
