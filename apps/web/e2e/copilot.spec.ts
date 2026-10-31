import { expect, type Page, test } from '@playwright/test';
import { PORTS } from '../playwright.config';

const QUESTION = 'Which 3 campaigns had the biggest ROAS drop last week compared to the week before, and why?';

async function ask(page: Page) {
  await page.getByTestId('example-question-0').click();
  await expect(page.getByTestId('question-input')).toHaveValue(QUESTION);
  // The scripted provider is offered (and selected) because the server runs on it.
  await expect(page.getByTestId('provider-option-fake')).toBeChecked();
  await page.getByTestId('submit-question').click();
}

test('asks a question, streams steps live, and shows a grounded answer with findings', async ({ page }) => {
  await page.goto('/');
  await ask(page);

  const card = page.getByTestId('answer-card');
  await expect(card).toHaveAttribute('data-status', 'running');
  // Steps arrive over SSE while the run is still going.
  await expect(page.getByTestId('trace-step').first()).toBeVisible();
  await expect(card).toHaveAttribute('data-status', 'running');

  await expect(card).toHaveAttribute('data-status', 'completed', { timeout: 15_000 });
  await expect(page.getByTestId('trace-step')).toHaveCount(5);
  await expect(page.getByTestId('answer-summary')).toContainText('click-injection');
  await expect(page.getByTestId('confidence-badge')).toHaveAttribute('data-confidence', 'high');

  const rows = page.getByTestId('finding-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('cmp_007');
  const change = rows.first().getByTestId('finding-change');
  await expect(change).toHaveText('−49.2%');
  await expect(change).toHaveAttribute('data-sentiment', 'bad');
  await expect(page.getByTestId('total-cost')).not.toHaveText('$0');

  // Provenance: an evidence link highlights, then opens, the step that produced the number.
  const link = rows.first().getByTestId('evidence-link').first();
  const step = page.locator('[data-testid=trace-step][data-step-number="2"]');
  await link.hover();
  await expect(step).toHaveAttribute('data-highlighted', 'true');
  await link.click();
  await expect(step.locator('details')).toHaveAttribute('open', '');
  await expect(step).toContainText('Compared two periods');
});

test('lists runs in history and reopens them, also after a reload', async ({ page }) => {
  await page.goto('/');
  await ask(page);
  await expect(page.getByTestId('answer-card')).toHaveAttribute('data-status', 'completed', { timeout: 15_000 });
  const runUrl = page.url();
  expect(runUrl).toMatch(/#\/runs\/[0-9a-f-]{36}$/);

  const item = page.getByTestId('run-history-item').first();
  await expect(item).toContainText('biggest ROAS drop');
  await expect(item.getByTestId('status-badge')).toHaveAttribute('data-status', 'completed');

  await page.getByTestId('new-question').click();
  await expect(page.getByTestId('answer-card')).toHaveCount(0);
  await item.click();
  await expect(page.getByTestId('answer-card')).toHaveAttribute('data-status', 'completed');

  await page.reload();
  await expect(page.getByTestId('answer-card')).toHaveAttribute('data-status', 'completed');
  await expect(page.getByTestId('finding-row')).toHaveCount(2);
});

test('a crashed run shows Resume and completes without repeating finished tools', async ({ page }) => {
  await page.goto(`http://localhost:${PORTS.crashWeb}/`);
  await ask(page);

  const card = page.getByTestId('answer-card');
  await expect(card).toHaveAttribute('data-status', 'failed', { timeout: 15_000 });
  await expect(page.getByTestId('run-error')).toContainText('Simulated crash after step 3');
  await expect(page.getByTestId('trace-step')).toHaveCount(3);

  const resume = page.getByTestId('resume-run');
  await expect(resume).toHaveText('Resume from step 4');
  await resume.click();

  await expect(card).toHaveAttribute('data-status', 'completed', { timeout: 15_000 });
  await expect(page.getByTestId('resume-divider')).toContainText('Resumed after step 3');
  await expect(page.getByTestId('finding-row')).toHaveCount(2);
  // The comparison ran before the crash and must not run again.
  await expect(page.locator('[data-testid=trace-step][data-step-type=tool_call]').filter({ hasText: 'Compared two periods' })).toHaveCount(1);
  await expect(page.locator('[data-testid=trace-step][data-step-type=tool_call]')).toHaveCount(2);
});

test('the API rejects invalid questions with the shared error shape', async ({ request }) => {
  const bad = await request.post('http://localhost:3101/runs', { data: { question: 'x' } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error.code).toBe('validation_error');
});
