import { describe, expect, it } from 'vitest'
import {
  AVERAGE_RATING,
  adjustProbability,
  clamp,
  normalizeRating,
} from '../../../src/core/shared/probability.ts'

describe('clamp', () => {
  it('keeps values inside the range and passes through values already inside', () => {
    expect(clamp(-1, 0, 1)).toBe(0)
    expect(clamp(2, 0, 1)).toBe(1)
    expect(clamp(0.4, 0, 1)).toBe(0.4)
  })
})

describe('normalizeRating', () => {
  it('maps the 1–20 scale onto -1…+1 with the league average at 0', () => {
    expect(normalizeRating(AVERAGE_RATING)).toBe(0)
    expect(normalizeRating(1)).toBeCloseTo(-1, 12)
    expect(normalizeRating(20)).toBeCloseTo(1, 12)
  })

  it('is linear, so a uniform rating shift is a uniform edge shift', () => {
    const step = normalizeRating(13) - normalizeRating(10)
    expect(normalizeRating(18) - normalizeRating(15)).toBeCloseTo(step, 12)
  })
})

describe('adjustProbability', () => {
  it('returns the base rate when the edge is zero', () => {
    for (const base of [0.01, 0.25, 0.5, 0.9])
      expect(adjustProbability(base, 0)).toBeCloseTo(base, 12)
  })

  it('moves up for a positive edge and down for a negative one', () => {
    expect(adjustProbability(0.4, 0.5)).toBeGreaterThan(0.4)
    expect(adjustProbability(0.4, -0.5)).toBeLessThan(0.4)
  })

  it('is symmetric on the log-odds scale (an edge and its opposite undo each other)', () => {
    expect(adjustProbability(adjustProbability(0.3, 0.8), -0.8)).toBeCloseTo(0.3, 12)
  })

  it('stays strictly inside (0, 1) even for huge edges', () => {
    for (const edge of [-30, -5, 5, 30]) {
      const p = adjustProbability(0.5, edge)
      expect(p).toBeGreaterThan(0)
      expect(p).toBeLessThanOrEqual(1)
      expect(Number.isFinite(p)).toBe(true)
    }
  })

  it('has diminishing returns near the extremes', () => {
    const middleGain = adjustProbability(0.5, 0.5) - 0.5
    const extremeGain = adjustProbability(0.95, 0.5) - 0.95
    expect(extremeGain).toBeLessThan(middleGain)
  })
})
