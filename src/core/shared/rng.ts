/**
 * Seeded random number generator.
 * All randomness in the game must come from here (never Math.random) so that
 * the same seed always produces the same simulation — needed for replays and bug repros.
 */

/** A deterministic random number source created from a seed. */
export interface Rng {
  /** Returns a float in [0, 1). */
  next(): number
  /** Returns an integer between min and max, inclusive. */
  nextInt(min: number, max: number): number
  /** Returns true with the given probability (0 to 1). */
  chance(probability: number): boolean
  /** Returns one item from a non-empty array, chosen uniformly. */
  pick<T>(items: readonly T[]): T
}

/** Creates a seeded RNG; the same seed always yields the same sequence of numbers. */
export function createRng(seed: number): Rng {
  // Algorithm choice: mulberry32 — tiny, fast, and statistically good enough for game simulation.
  // It is NOT cryptographically secure, which is fine for a game.
  let state = seed >>> 0

  /** Advances the internal state and returns the next float in [0, 1). */
  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Returns an integer between min and max, inclusive. */
  function nextInt(min: number, max: number): number {
    if (max < min) throw new RangeError(`nextInt: max (${max}) is less than min (${min})`)
    return min + Math.floor(next() * (max - min + 1))
  }

  /** Returns true with the given probability. */
  function chance(probability: number): boolean {
    return next() < probability
  }

  /** Returns a uniformly chosen item from a non-empty array. */
  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick: cannot pick from an empty array')
    return items[nextInt(0, items.length - 1)] as T
  }

  return { next, nextInt, chance, pick }
}
