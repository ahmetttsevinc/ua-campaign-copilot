import type { RunStatus } from '@copilot/shared';

const STATUS: Record<RunStatus, { label: string; className: string }> = {
  running: { label: 'Running', className: 'bg-cobalt-wash text-cobalt' },
  completed: { label: 'Answered', className: 'bg-good-wash text-good' },
  failed: { label: 'Failed', className: 'bg-bad-wash text-bad' },
  failed_validation: { label: 'Invalid answer', className: 'bg-caution-wash text-caution' },
  budget_exceeded: { label: 'Over budget', className: 'bg-caution-wash text-caution' },
  max_steps_exceeded: { label: 'Too many steps', className: 'bg-caution-wash text-caution' },
};

export function StatusBadge({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return (
    <span data-testid="status-badge" data-status={status} className={`rounded-sm px-1.5 py-px text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}
