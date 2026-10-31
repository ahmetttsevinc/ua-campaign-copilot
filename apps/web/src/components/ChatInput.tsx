import type { ProviderName } from '@copilot/shared';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { clearApiKey, getApiKey, setApiKey } from '../lib/apiKeys';
import { PROVIDER_LABELS } from '../lib/format';

export interface ProviderOption {
  name: ProviderName;
  /** False when the server has no key for this provider and the user must enter one. */
  serverKey: boolean;
}

export const EXAMPLE_QUESTIONS = [
  'Which 3 campaigns had the biggest ROAS drop last week compared to the week before, and why?',
  'Is cmp_007 performing worse because of fraud?',
  'Which campaigns have good install volume but poor user quality?',
];

interface Props {
  /** Once an answer is on screen the form shrinks so the answer gets the space. */
  compact: boolean;
  providers: ProviderOption[];
  defaultProvider: ProviderName;
  submitting: boolean;
  error: string | null;
  onSubmit: (question: string, provider: ProviderName, apiKey: string | null) => void;
}

const KEY_HINTS: Partial<Record<ProviderName, string>> = { anthropic: 'sk-ant-…', nebius: 'Nebius Token Factory key' };

export function ChatInput({ compact, providers, defaultProvider, submitting, error, onSubmit }: Props) {
  const [question, setQuestion] = useState('');
  const [provider, setProvider] = useState<ProviderName>(defaultProvider);
  const [keyDraft, setKeyDraft] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(() => getApiKey(defaultProvider));
  const needsKey = providers.find((p) => p.name === provider)?.serverKey === false;
  const activeKey = needsKey ? (keyDraft.trim() || savedKey) : null;
  const canSubmit = question.trim().length >= 3 && !submitting && (!needsKey || Boolean(activeKey));

  const choose = (p: ProviderName) => {
    setProvider(p);
    setKeyDraft('');
    setSavedKey(getApiKey(p));
  };
  const forget = () => {
    clearApiKey(provider);
    setSavedKey(null);
    setKeyDraft('');
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    if (needsKey && keyDraft.trim()) {
      setApiKey(provider, keyDraft.trim());
      setSavedKey(keyDraft.trim());
      setKeyDraft('');
    }
    onSubmit(question.trim(), provider, activeKey);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Ask a question">
      <label htmlFor="question" className={compact ? 'sr-only' : 'block text-lg font-semibold tracking-tight'}>
        What changed, and why?
      </label>
      <textarea
        id="question"
        data-testid="question-input"
        rows={compact ? 1 : 3}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={compact ? 'Ask another question' : 'Ask about campaigns, e.g. why did ROAS drop for Tile Tide US last week?'}
        className="w-full resize-y rounded-sm border border-rule bg-surface px-3 py-2.5 text-[15px] leading-relaxed placeholder:text-muted/70 focus:border-cobalt focus:outline-none"
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <fieldset className="flex items-center gap-2" data-testid="provider-select">
          <legend className="sr-only">Model provider</legend>
          <span className="text-sm text-muted" aria-hidden>
            Model
          </span>
          <div className="inline-flex rounded-sm border border-rule bg-surface p-0.5">
            {providers.map(({ name: p }) => (
              <label
                key={p}
                className={`cursor-pointer rounded-[2px] px-2.5 py-1 text-sm has-focus-visible:outline-2 has-focus-visible:outline-cobalt ${
                  provider === p ? 'bg-ink text-surface' : 'text-ink hover:bg-paper'
                }`}
              >
                <input
                  type="radio"
                  name="provider"
                  value={p}
                  checked={provider === p}
                  onChange={() => choose(p)}
                  data-testid={`provider-option-${p}`}
                  className="sr-only"
                />
                {PROVIDER_LABELS[p]}
              </label>
            ))}
          </div>
        </fieldset>

        {needsKey &&
          (savedKey && !keyDraft ? (
            <span data-testid="api-key-saved" className="flex items-center gap-2 text-sm text-muted">
              Using your {PROVIDER_LABELS[provider]} key for this tab
              <button type="button" data-testid="api-key-forget" onClick={forget} className="font-medium text-cobalt hover:underline">
                Forget key
              </button>
            </span>
          ) : (
            <label className="flex min-w-64 flex-1 items-center gap-2 text-sm">
              <span className="whitespace-nowrap text-muted">{PROVIDER_LABELS[provider]} API key</span>
              <input
                type="password"
                data-testid="api-key-input"
                autoComplete="off"
                spellCheck={false}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder={KEY_HINTS[provider] ?? 'API key'}
                aria-describedby="api-key-note"
                className="min-w-0 flex-1 rounded-sm border border-rule bg-surface px-2 py-1 font-mono text-sm focus:border-cobalt focus:outline-none"
              />
            </label>
          ))}

        <button
          type="submit"
          data-testid="submit-question"
          disabled={!canSubmit}
          className="ml-auto rounded-sm bg-cobalt px-4 py-1.5 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Asking…' : 'Ask'}
        </button>
      </div>

      {needsKey && !savedKey && (
        <p id="api-key-note" className="text-xs text-muted">
          The server has no {PROVIDER_LABELS[provider]} key. Yours stays in this browser tab, is sent only with your own
          requests, and is never saved on the server.
        </p>
      )}

      {error && (
        <p role="alert" data-testid="submit-error" className="text-sm text-bad">
          {error}
        </p>
      )}

      {!compact && (
      <div className="flex flex-wrap gap-2 pt-1" aria-label="Example questions">
        {EXAMPLE_QUESTIONS.map((q, i) => (
          <button
            key={q}
            type="button"
            data-testid={`example-question-${i}`}
            onClick={() => setQuestion(q)}
            className="rounded-sm border border-dashed border-rule px-2.5 py-1 text-left text-sm text-muted hover:border-muted hover:text-ink"
          >
            {q}
          </button>
        ))}
      </div>
      )}
    </form>
  );
}
