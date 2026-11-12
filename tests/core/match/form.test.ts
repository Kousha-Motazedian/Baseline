/**
 * Game-day form from the hidden Consistency attribute: the spread curve and the shape of the roll.
 */
import { describe, expect, it } from 'vitest'
import { formSpread, rollForm } from '../../../src/core/match/state.ts'
import { FORM_CLAMP_SDS } from '../../../src/core/match/tuning.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { makePlayer } from '../../helpers/fixtures.ts'
import { mean, standardDeviation } from '../../helpers/simulation.ts'

/** `draws` form rolls for a player with the given Consistency, from one seeded stream. */
function rolls(consistency: number, draws: number): number[] {
  const rng = createRng(consistency * 31)
  const player = makePlayer({ id: 'p', consistency })
  return Array.from({ length: draws }, () => rollForm(rng, player))
}

describe('Consistency → form spread', () => {
  it('shrinks strictly as Consistency rises, ~10x from 1 to 20', () => {
    for (let c = 1; c < 20; c++) expect(formSpread(c + 1)).toBeLessThan(formSpread(c))
    expect(formSpread(1) / formSpread(20)).toBeCloseTo(10, 6)
    expect(formSpread(1)).toBeCloseTo(0.3, 10)
    expect(formSpread(10.5)).toBeCloseTo(0.0975, 10)
  })

  it('clamps out-of-range ratings to the 1–20 ends', () => {
    expect(formSpread(-5)).toBe(formSpread(1))
    expect(formSpread(25)).toBe(formSpread(20))
  })

  it('rolls are centered on 0, match the spread, and never pass the clamp', () => {
    for (const consistency of [1, 10, 20]) {
      const draws = rolls(consistency, 20_000)
      const sd = formSpread(consistency)
      expect(Math.abs(mean(draws))).toBeLessThan(0.03 * sd + 0.002)
      // Clamping at 2.5 SD trims ~1% of the spread.
      expect(standardDeviation(draws) / sd).toBeGreaterThan(0.95)
      expect(standardDeviation(draws) / sd).toBeLessThan(1.02)
      for (const x of draws) expect(Math.abs(x)).toBeLessThanOrEqual(FORM_CLAMP_SDS * sd + 1e-12)
    }
  })
})
