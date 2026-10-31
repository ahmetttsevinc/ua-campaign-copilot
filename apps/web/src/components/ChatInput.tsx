import type { ProviderName } from '@copilot/shared';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { clearApiKey, getApiKey, setApiKey } from '../lib/apiKeys';
import { PROVIDER_LABELS } from '../lib/format';
import { ArrowRightIcon, Spinner } from './icons';

export const EXAMPLE_QUESTIONS = [
  'Which 3 campaigns had the biggest ROAS drop last week compared to the week before, and why?',
  'Is cmp_007 performing worse because of fraud?',
  'Which campaigns have good install volume but poor user quality?',
];

export interface ProviderOption {
  name: ProviderName;
  /** False when the server has no key for this provider and the user must enter one. */
  serverKey: boolean;
}

interface Props {
  /** Once an answer is on screen the form shrinks so the answer gets the space. */
  compact: boolean;
  providers: ProviderOption[];
  defaultProvider: ProviderName;
  submitting: boolean;
  error: string | null;
  onSubmit: (question: string, provider: ProviderName, apiKey: string | null) => void;
}

const KEY_HINTS: Partial<Record<ProviderName, string>> = { anthropic: 'sk-ant-…', nebius: 'Token Factory key' };
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function ChatInput({ compact, providers, defaultProvider, submitting, error, onSubmit }: Props) {
  const [question, setQuestion] = useState('');
  const [provider, setProvider] = useState<ProviderName>(defaultProvider);
  const [keyDraft, setKeyDraft] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(() => getApiKey(defaultProvider));
  const needsKey = providers.find((p) => p.name === provider)?.serverKey === false;
  const activeKey = needsKey ? keyDraft.trim() || savedKey : null;
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
    <form onSubmit={submit} aria-label="Ask a question" className="space-y-3">
      {!compact && (
        <div>
          <label htmlFor="question" className="text-base font-semibold tracking-tight">
            What changed, and why?
          </label>
          <p className="mt-0.5 text-muted">Ask in plain language. Every number in the answer links back to the system it came from.</p>
        </div>
      )}
      {compact && (
        <label htmlFor="question" className="sr-only">
          Ask another question
        </label>
      )}

      <div className="rounded-lg border border-rule-strong bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)] focus-within:border-accent">
        <textarea
          id="question"
          data-testid="question-input"
          rows={compact ? 1 : 3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={compact ? 'Ask another question' : 'e.g. Why did ROAS drop for Tile Tide US last week?'}
          className="block w-full resize-none rounded-t-lg bg-transparent px-3.5 pt-3 pb-2 text-[15px] leading-relaxed placeholder:text-faint focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule px-2.5 py-2">
          <fieldset className="flex items-center gap-2" data-testid="provider-select">
            <legend className="sr-only">Model</legend>
            <span className="text-xs font-medium text-muted" aria-hidden>
              Model
            </span>
            <div className="inline-flex rounded-md border border-rule bg-sunken p-0.5">
              {providers.map(({ name: p }) => (
                <label
                  key={p}
                  className={`cursor-pointer rounded-[5px] px-3 py-1 text-[13px] font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-accent ${
                    provider === p ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(16,24,40,0.12)]' : 'text-muted hover:text-ink'
                  }`}
                >
                  <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => choose(p)} data-testid={`provider-option-${p}`} className="sr-only" />
                  {PROVIDER_LABELS[p]}
                </label>
              ))}
            </div>
          </fieldset>

          {needsKey &&
            (savedKey && !keyDraft ? (
              <span data-testid="api-key-saved" className="flex items-center gap-2 text-xs text-muted">
                Using your {PROVIDER_LABELS[provider]} key for this tab
                <button type="button" data-testid="api-key-forget" onClick={forget} className="font-medium text-accent hover:underline">
                  Forget key
                </button>
              </span>
            ) : (
              <label className="flex min-w-60 flex-1 items-center gap-2">
                <span className="text-xs font-medium whitespace-nowrap text-muted">API key</span>
                <input
                  type="password"
                  data-testid="api-key-input"
                  autoComplete="off"
                  spellCheck={false}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={KEY_HINTS[provider] ?? 'API key'}
                  aria-describedby="api-key-note"
                  className="num min-w-0 flex-1 rounded-md border border-rule bg-surface px-2 py-1 text-xs focus:border-accent focus:outline-none"
                />
              </label>
            ))}

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-faint sm:inline" aria-hidden>
              <kbd className="num rounded border border-rule px-1 py-px text-[11px]">{isMac ? '⌘' : 'Ctrl'}</kbd>{' '}
              <kbd className="num rounded border border-rule px-1 py-px text-[11px]">Enter</kbd>
            </span>
            <button
              type="submit"
              data-testid="submit-question"
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-accent-ink transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-faint disabled:hover:brightness-100"
            >
              {submitting ? <Spinner size={13} /> : <ArrowRightIcon size={14} />}
              {submitting ? 'Asking…' : 'Ask'}
            </button>
          </div>
        </div>
      </div>

      {needsKey && !savedKey && (
        <p id="api-key-note" className="text-xs text-muted">
          The server has no {PROVIDER_LABELS[provider]} key. Yours stays in this browser tab, is sent only with your own requests, and is never saved on the server.
        </p>
      )}

      {error && (
        <p role="alert" data-testid="submit-error" className="text-sm text-neg">
          {error}
        </p>
      )}

      {!compact && question.trim() === '' && (
        <div className="flex flex-wrap gap-2" aria-label="Example questions">
          {EXAMPLE_QUESTIONS.map((q, i) => (
            <button
              key={q}
              type="button"
              data-testid={`example-question-${i}`}
              onClick={() => setQuestion(q)}
              className="rounded-full border border-rule bg-surface px-3 py-1 text-left text-[13px] text-muted transition-colors hover:border-rule-strong hover:text-ink"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
