import { FinalAnswer } from '@copilot/shared';

export const MAX_REPAIRS = 2;

/** Pulls a JSON object out of model text, tolerating code fences and stray prose around it. */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1] ?? '');
  const candidates = fenced.length ? [...fenced].reverse() : [];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  if (candidates.length === 0) return { ok: false, error: 'No JSON object found in the reply.' };

  let lastError = '';
  for (const c of candidates) {
    try {
      return { ok: true, value: JSON.parse(c.trim()) };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, error: `Reply contains invalid JSON: ${lastError}` };
}

export type ParseResult = { ok: true; answer: FinalAnswer } | { ok: false; errors: string[] };

export function parseFinalAnswer(text: string | undefined): ParseResult {
  if (!text?.trim()) return { ok: false, errors: ['The reply was empty. A final JSON answer is required.'] };
  const json = extractJson(text);
  if (!json.ok) return { ok: false, errors: [json.error] };
  const parsed = FinalAnswer.safeParse(json.value);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  return { ok: true, answer: parsed.data };
}

export function repairMessage(errors: string[], truncated: boolean): string {
  return [
    truncated ? 'Your previous reply was cut off before it finished.' : 'Your previous reply was not a valid final answer.',
    'Problems found:',
    ...errors.map((e) => `- ${e}`),
    '',
    'Reply again with ONLY the corrected JSON object in the required shape (summary, findings, caveats, confidence). No prose, no code fences. Keep it concise.',
  ].join('\n');
}
