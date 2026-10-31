import type { ReactNode } from 'react';

// Light JSON highlighting with React elements only (no innerHTML): keys muted, numbers accent,
// literals faint. Strings stay in the body colour so the data itself is what stands out.
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

export function highlightJson(value: unknown): ReactNode[] {
  const text = JSON.stringify(value, null, 2) ?? 'undefined';
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const [whole, str, colon, literal] = m;
    if (str && colon) out.push(<span key={i} className="text-muted">{str}</span>, colon);
    else if (str) out.push(<span key={i}>{str}</span>);
    else if (literal) out.push(<span key={i} className="text-faint italic">{literal}</span>);
    else out.push(<span key={i} className="text-accent">{whole}</span>);
    last = i + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
