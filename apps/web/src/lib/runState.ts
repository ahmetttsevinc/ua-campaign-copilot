import type { AgentEvent, AgentRun, AgentStep, StepType } from '@copilot/shared';

export interface InFlightStep {
  stepNumber: number;
  stepType: StepType;
  toolName: string | null;
}

/** A run as the UI shows it: the persisted run plus steps that have started but not finished. */
export type RunView = AgentRun & { inFlight: InFlightStep[] };

export const toView = (run: AgentRun): RunView => ({ ...run, inFlight: [] });

function upsertStep(steps: AgentStep[], step: AgentStep): AgentStep[] {
  // Parallel tool calls finish out of order; the trace is always shown in step order.
  return [...steps.filter((s) => s.stepNumber !== step.stepNumber), step].sort((a, b) => a.stepNumber - b.stepNumber);
}

/** Pure reducer from SSE events to view state; replayed events are idempotent. */
export function applyEvent(view: RunView, event: AgentEvent): RunView {
  switch (event.type) {
    case 'run_started':
      return { ...view, ...event.run, status: 'running' };
    case 'step_started':
      if (view.steps.some((s) => s.stepNumber === event.stepNumber) || view.inFlight.some((s) => s.stepNumber === event.stepNumber)) {
        return view;
      }
      return { ...view, inFlight: [...view.inFlight, { stepNumber: event.stepNumber, stepType: event.stepType, toolName: event.toolName }] };
    case 'step_completed':
      return {
        ...view,
        ...event.run,
        steps: upsertStep(view.steps, event.step),
        inFlight: view.inFlight.filter((s) => s.stepNumber !== event.step.stepNumber),
      };
    case 'run_completed':
    case 'run_failed':
      return toView(event.run);
  }
}
