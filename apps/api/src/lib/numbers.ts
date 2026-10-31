// Tools round before returning so the model sees (and later quotes) stable, readable numbers.
// The grounding check in M3 matches answer numbers against these rounded values.

export const roundTo = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
export const money = (n: number) => roundTo(n, 2);
export const ratio = (n: number) => roundTo(n, 4);

/** Percentage change, null when there is no meaningful baseline. */
export function pctChange(before: number | null, after: number | null): number | null {
  if (before === null || after === null || before === 0) return null;
  return roundTo(((after - before) / Math.abs(before)) * 100, 1);
}

export function absChange(before: number | null, after: number | null, digits: number): number | null {
  if (before === null || after === null) return null;
  return roundTo(after - before, digits);
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
