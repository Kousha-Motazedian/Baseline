import { describe, expect, it } from 'vitest'
import { randomNormal } from '../../../src/core/shared/normal.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { mean, standardDeviation } from '../../helpers/simulation.ts'

/** Draws `count` samples from N(mean, sd) with a fixed seed. */
function samples(count: number, mu: number, sd: number, seed = 3): number[] {
  const rng = createRng(seed)
  return Array.from({ length: count }, () => randomNormal(rng, mu, sd))
}

describe('randomNormal', () => {
  it('has the requested mean and standard deviation', () => {
    // 50,000 draws: SE of the mean is sd/224 ≈ 0.013, SE of the SD ≈ 0.009 for sd = 2.
    const values = samples(50_000, 10, 2)
    expect(Math.abs(mean(values) - 10)).toBeLessThan(0.05)
    expect(Math.abs(standardDeviation(values) - 2)).toBeLessThan(0.05)
  })

  it('puts about 68% of draws within one SD and about 95% within two', () => {
    const values = samples(50_000, 0, 1)
    const within = (k: number): number =>
      values.filter((v) => Math.abs(v) < k).length / values.length
    expect(Math.abs(within(1) - 0.6827)).toBeLessThan(0.01)
    expect(Math.abs(within(2) - 0.9545)).toBeLessThan(0.006)
  })

  it('always returns a finite number (never log(0))', () => {
    for (const v of samples(100_000, 0, 1, 11)) expect(Number.isFinite(v)).toBe(true)
  })

  it('returns exactly the mean when the SD is zero', () => {
    expect(samples(10, 4.2, 0)).toEqual(Array.from({ length: 10 }, () => 4.2))
  })
})
