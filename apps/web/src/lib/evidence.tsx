import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

/**
 * Shared state for the provenance link between a finding's evidence ("step_4") and the
 * trace row that produced the number. Hover highlights, click focuses (expand + scroll).
 */
interface EvidenceState {
  highlighted: number | null;
  setHighlighted: (step: number | null) => void;
  focused: { step: number; nonce: number } | null;
  focus: (step: number) => void;
}

const Ctx = createContext<EvidenceState | null>(null);

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [focused, setFocused] = useState<EvidenceState['focused']>(null);
  const value = useMemo(
    // The nonce makes clicking the same chip twice scroll again.
    () => ({ highlighted, setHighlighted, focused, focus: (step: number) => setFocused({ step, nonce: Date.now() }) }),
    [highlighted, focused],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEvidence(): EvidenceState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEvidence must be used inside EvidenceProvider');
  return v;
}

/** "step_4" -> 4; anything else -> null (the model occasionally cites free text). */
export function parseStepRef(ref: string): number | null {
  const m = /^step[_\s-]?(\d+)$/i.exec(ref.trim());
  return m ? Number(m[1]) : null;
}
