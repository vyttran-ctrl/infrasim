// Seeded pseudo-random numbers. Every random decision in the simulation goes
// through an `Rng` built from the scenario seed plus a stream label, so that
// independent concerns (trip list, driver parameters, pedestrians, rerouting)
// never consume each other's numbers.

/** mulberry32: tiny, fast, good-enough 32-bit PRNG. Returns floats in [0, 1). */
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

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string, h = 2166136261): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Derive an independent stream seed from a scenario seed and a label. */
export function streamSeed(seed: number, stream: string): number {
  let h = hashString(stream, (2166136261 ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0);
  // final avalanche
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class Rng {
  private f: () => number;
  constructor(seed: number) {
    this.f = mulberry32(seed);
  }
  static stream(seed: number, label: string): Rng {
    return new Rng(streamSeed(seed, label));
  }
  /** [0, 1) */
  next(): number {
    return this.f();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.f();
  }
  int(n: number): number {
    return Math.min(n - 1, Math.floor(this.f() * n));
  }
  /** Exponential variate with the given rate (events per unit). */
  exp(rate: number): number {
    return -Math.log(1 - this.f()) / rate;
  }
}

/** Index into `weights` chosen with probability proportional to weight, from a uniform `u`. */
export function pickWeighted(weights: ArrayLike<number>, total: number, u: number): number {
  let x = u * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  // numerical edge: last positive weight
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
  return 0;
}
