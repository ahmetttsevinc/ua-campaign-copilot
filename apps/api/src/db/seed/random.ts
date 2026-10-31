// Tiny seeded PRNG so the dataset is byte-for-byte reproducible without a dependency.

/** FNV-1a 32-bit hash; used to derive an independent stream per campaign from one global seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: small, fast and good enough for synthetic data. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export const between = (rng: Rng, min: number, max: number): number => min + rng() * (max - min);

/** Multiplicative noise centred on 1, e.g. spread 0.1 gives [0.95, 1.05). */
export const noise = (rng: Rng, spread: number): number => 1 + (rng() - 0.5) * spread;
