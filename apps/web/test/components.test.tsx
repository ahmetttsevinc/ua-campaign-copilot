import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnswerCard } from '../src/components/AnswerCard';
import { ChatInput } from '../src/components/ChatInput';
import { DataTable } from '../src/components/DataTable';
import { StepTrace } from '../src/components/StepTrace';
import { EvidenceProvider } from '../src/lib/evidence';
import { llmStep, step, view } from './fixtures';

afterEach(cleanup);
// jsdom has neither; StepTrace uses them when an evidence link is clicked.
window.matchMedia ??= ((q: string) => ({ matches: false, media: q }) as MediaQueryList) as typeof window.matchMedia;
Element.prototype.scrollIntoView ??= vi.fn();

const finding = {
  campaignId: 'cmp_007',
  campaignName: 'Tile Tide | US | Android',
  metric: 'roas',
  before: 0.9318,
  after: 0.4738,
  changePct: -49.2,
  likelyCause: 'Click injection fraud',
  evidence: ['step_2', 'step_4'],
};

describe('DataTable', () => {
  it('renders findings with formatted values, exact values on hover and sentiment', () => {
    render(
      <EvidenceProvider>
        <DataTable findings={[finding, { ...finding, campaignId: 'cmp_012', metric: 'cpi', before: 4.81, after: 8.93, changePct: 85.7 }]} />
      </EvidenceProvider>,
    );
    const rows = screen.getAllByTestId('finding-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('0.47').getAttribute('title')).toBe('0.4738');
    const changes = screen.getAllByTestId('finding-change');
    expect(changes.map((c) => [c.textContent, c.dataset.sentiment])).toEqual([
      ['−49.2%', 'bad'],
      ['+85.7%', 'bad'],
    ]);
    expect(within(rows[0] as HTMLElement).getAllByTestId('evidence-link').map((e) => e.dataset.step)).toEqual(['2', '4']);
  });

  it('shows a one-line cause headline and expands to the full explanation', () => {
    render(
      <EvidenceProvider>
        <DataTable findings={[{ ...finding, likelyCause: 'Click injection fraud. 30% suspicious installs and a 5 s median CTIT.' }]} />
      </EvidenceProvider>,
    );
    const row = screen.getByTestId('finding-row');
    expect(row.textContent).toContain('Click injection fraud.');
    expect(row.textContent).not.toContain('5 s median CTIT');
    fireEvent.click(screen.getByTestId('finding-expand'));
    expect(row.textContent).toContain('5 s median CTIT');
    expect(screen.getByTestId('finding-expand').getAttribute('aria-expanded')).toBe('true');
  });

  it('says so when there is nothing to report', () => {
    render(
      <EvidenceProvider>
        <DataTable findings={[]} />
      </EvidenceProvider>,
    );
    expect(screen.getByTestId('findings-empty')).toBeTruthy();
  });
});

describe('StepTrace with evidence links', () => {
  it('highlights the step an evidence link points to and opens it on click', () => {
    const run = view({
      status: 'completed',
      steps: [llmStep(1, { stopReason: 'tool_use', toolCalls: [{ name: 'compare_campaign_periods' }] }), step(2), llmStep(3, { stopReason: 'end_turn', toolCalls: [] })],
      finalAnswer: { summary: 's', findings: [{ ...finding, evidence: ['step_2'] }], caveats: [], confidence: 'high' },
    });
    render(
      <EvidenceProvider>
        <AnswerCard run={run} />
        <StepTrace run={run} />
      </EvidenceProvider>,
    );
    const target = () => screen.getAllByTestId('trace-step').find((li) => li.dataset.stepNumber === '2') as HTMLElement;
    const link = screen.getByTestId('evidence-link');

    fireEvent.mouseEnter(link);
    expect(target().dataset.highlighted).toBe('true');
    fireEvent.mouseLeave(link);
    expect(target().dataset.highlighted).toBeUndefined();

    fireEvent.click(link);
    expect(target().querySelector('details')?.open).toBe(true);
    expect(screen.getByTestId('trace-totals').textContent).toContain('Steps3');
  });

  it('shows in-flight steps and error / retry badges', () => {
    const run = view({
      steps: [llmStep(1, { stopReason: 'tool_use', toolCalls: [{ name: 'x' }] }, { input: { retries: 2 } }), step(2, { isError: true, toolName: 'dummy' })],
    });
    render(
      <EvidenceProvider>
        <StepTrace run={{ ...run, inFlight: [{ stepNumber: 3, stepType: 'llm_call', toolName: null }] }} />
      </EvidenceProvider>,
    );
    expect(screen.getByTestId('step-retry-badge').textContent).toBe('Retried 2×');
    expect(screen.getByTestId('step-error-badge')).toBeTruthy();
    expect(screen.getByTestId('trace-step-inflight').textContent).toContain('Model is thinking');
  });
});

describe('AnswerCard states', () => {
  const renderCard = (over: Parameters<typeof view>[0]) =>
    render(
      <EvidenceProvider>
        <AnswerCard run={view(over)} />
      </EvidenceProvider>,
    );

  it('shows the answer with confidence and caveats when completed', () => {
    renderCard({ status: 'completed', finalAnswer: { summary: 'Two campaigns dropped.', findings: [finding], caveats: ['Top 3 only.'], confidence: 'medium' } });
    expect(screen.getByTestId('answer-summary').textContent).toBe('Two campaigns dropped.');
    expect(screen.getByTestId('confidence-badge').dataset.confidence).toBe('medium');
    expect(screen.getByTestId('caveats').textContent).toContain('Top 3 only.');
  });

  it('never shows unvalidated output as an answer', () => {
    renderCard({ status: 'failed_validation', error: 'Final answer still invalid after 2 repair attempts: confidence: bad\n\nRaw model output:\n{"summary": "x"}' });
    expect(screen.queryByTestId('answer-summary')).toBeNull();
    expect(screen.getByTestId('validation-warning').textContent).toContain('did not pass validation');
    expect(screen.getByTestId('validation-raw').textContent).toBe('{"summary": "x"}');
  });

  it('offers Resume on resumable failures and shows where a resumed run picked up', () => {
    const onResume = vi.fn();
    const run = view({ status: 'failed', resumable: true, error: 'Simulated crash after step 3', steps: [step(1), step(2), step(3)] });
    render(
      <EvidenceProvider>
        <AnswerCard run={run} resume={{ onResume, resuming: false, error: null }} />
      </EvidenceProvider>,
    );
    const button = screen.getByTestId('resume-run');
    expect(button.textContent).toBe('Resume from step 4');
    fireEvent.click(button);
    expect(onResume).toHaveBeenCalledOnce();
    cleanup();

    render(
      <EvidenceProvider>
        <StepTrace run={view({ status: 'completed', steps: [step(1), step(2), step(3), step(4, { input: { toolCallId: 'c4', input: {}, resumedAfterStep: 3 } })] })} />
      </EvidenceProvider>,
    );
    const items = screen.getByTestId('step-trace').children;
    expect([...items].map((li) => (li as HTMLElement).dataset.testid)).toEqual(['trace-step', 'trace-step', 'trace-step', 'resume-divider', 'trace-step']);
    expect(screen.getByTestId('resume-divider').textContent).toContain('Resumed after step 3');
  });

  it('does not offer Resume for runs that cannot be resumed', () => {
    renderCard({ status: 'failed', resumable: false, error: 'x' });
    expect(screen.queryByTestId('resume-run')).toBeNull();
  });

  it('explains failures and running state', () => {
    renderCard({ status: 'failed', error: 'HTTP 401: invalid x-api-key' });
    expect(screen.getByTestId('run-error').textContent).toContain('HTTP 401');
    cleanup();
    renderCard({ status: 'running' });
    expect(screen.getByTestId('answer-running')).toBeTruthy();
  });
});

describe('ChatInput', () => {
  it('fills from an example chip and submits with the chosen provider', () => {
    const onSubmit = vi.fn();
    render(
      <ChatInput
        compact={false}
        providers={[{ name: 'anthropic', serverKey: true }, { name: 'nebius', serverKey: true }]}
        defaultProvider="anthropic"
        submitting={false}
        error={null}
        onSubmit={onSubmit}
      />,
    );
    const submit = screen.getByTestId('submit-question') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('example-question-1'));
    fireEvent.click(screen.getByTestId('provider-option-nebius'));
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('Is cmp_007 performing worse because of fraud?', 'nebius', null);
    expect(screen.queryByTestId('api-key-input')).toBeNull();
  });

  it('asks for a key when the server has none, keeps it for the tab, and can forget it', () => {
    sessionStorage.clear();
    const onSubmit = vi.fn();
    render(<ChatInput compact={false} providers={[{ name: 'anthropic', serverKey: false }]} defaultProvider="anthropic" submitting={false} error={null} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('example-question-0'));
    const submit = screen.getByTestId('submit-question') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('api-key-input'), { target: { value: 'fake-demo-key-not-real' } });
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(expect.any(String), 'anthropic', 'fake-demo-key-not-real');
    expect(sessionStorage.getItem('ua-copilot:api-key:anthropic')).toBe('fake-demo-key-not-real');
    expect(screen.getByTestId('api-key-saved')).toBeTruthy();
    fireEvent.click(screen.getByTestId('api-key-forget'));
    expect(sessionStorage.getItem('ua-copilot:api-key:anthropic')).toBeNull();
    expect(screen.getByTestId('api-key-input')).toBeTruthy();
  });

  it('hides example questions in compact mode', () => {
    render(<ChatInput compact providers={[{ name: 'anthropic', serverKey: true }]} defaultProvider="anthropic" submitting={false} error={null} onSubmit={vi.fn()} />);
    expect(screen.queryByTestId('example-question-0')).toBeNull();
  });
});
