import { describe, expect, it } from 'vitest'
import { createRng } from '../../../src/core/shared/rng.ts'
import { pickWeighted } from '../../../src/core/shared/weighted.ts'

/** Counts how often each item is picked over `draws` weighted picks. */
function countPicks(weights: readonly number[], draws: number, seed = 1): number[] {
  const rng = createRng(seed)
  const counts = weights.map(() => 0)
  const indices = weights.map((_, i) => i)
  for (let i = 0; i < draws; i++) {
    const index = pickWeighted(rng, indices, (k) => weights[k] ?? 0)
    counts[index] = (counts[index] ?? 0) + 1
  }
  return counts
}

describe('pickWeighted', () => {
  it('picks in proportion to weight', () => {
    // 20,000 draws: the binomial SD of a share is ≤ 0.0035, so ±0.015 is > 4 SD.
    const counts = countPicks([1, 2, 7], 20_000)
    expect((counts[0] ?? 0) / 20_000).toBeCloseTo(0.1, 1)
    expect(Math.abs((counts[1] ?? 0) / 20_000 - 0.2)).toBeLessThan(0.015)
    expect(Math.abs((counts[2] ?? 0) / 20_000 - 0.7)).toBeLessThan(0.015)
  })

  it('never picks a zero-weight or negative-weight item', () => {
    const counts = countPicks([0, 3, -5, 1], 5_000)
    expect(counts[0]).toBe(0)
    expect(counts[2]).toBe(0)
  })

  it('falls back to a uniform pick when every weight is zero', () => {
    const counts = countPicks([0, 0, 0], 3_000)
    for (const c of counts) expect(c).toBeGreaterThan(800)
  })

  it('throws on an empty list', () => {
    expect(() => pickWeighted(createRng(1), [], () => 1)).toThrow(RangeError)
  })

  it('is deterministic for a given seed', () => {
    expect(countPicks([1, 2, 3, 4], 500, 9)).toEqual(countPicks([1, 2, 3, 4], 500, 9))
  })

  it('gives the same pick when every weight is scaled by the same factor', () => {
    // The engine's league-invariance argument relies on this: scaling all play weights
    // equally must not change which play is chosen for the same random draw.
    for (let seed = 0; seed < 200; seed++) {
      const a = pickWeighted(createRng(seed), [0, 1, 2, 3], (k) => [0.3, 1.1, 2.4, 0.7][k] ?? 0)
      const b = pickWeighted(
        createRng(seed),
        [0, 1, 2, 3],
        (k) => 4 * ([0.3, 1.1, 2.4, 0.7][k] ?? 0),
      )
      expect(b).toBe(a)
    }
  })
})
