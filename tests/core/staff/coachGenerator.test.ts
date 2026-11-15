import { describe, expect, it } from 'vitest'
import {
  COACH_ATTRIBUTE_KEYS,
  coachQuality,
  drawCoachQuality,
  generateCoach,
} from '../../../src/core/staff/coachGenerator.ts'
import type { HeadCoach } from '../../../src/core/staff/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { SYSTEM_ARCHETYPES } from '../../../src/core/tactics/system.ts'
import { mean } from '../../helpers/simulation.ts'

/** Generates `count` coaches from a fixed seed, at a fixed quality if given. */
function many(count: number, quality?: number, seed = 31): HeadCoach[] {
  const rng = createRng(seed)
  return Array.from({ length: count }, (_, i) => generateCoach(rng, { id: `c${i}`, quality }))
}

/** Pearson correlation of two equal-length series. */
function correlation(xs: readonly number[], ys: readonly number[]): number {
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  let syy = 0
  xs.forEach((x, i) => {
    const y = ys[i] as number
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
  })
  return sxy / Math.sqrt(sxx * syy)
}

describe('generateCoach', () => {
  it('is deterministic for the same seed and options', () => {
    expect(generateCoach(createRng(9), { id: 'a' })).toEqual(
      generateCoach(createRng(9), { id: 'a' }),
    )
  })

  it('differs across seeds', () => {
    expect(generateCoach(createRng(1), { id: 'a' })).not.toEqual(
      generateCoach(createRng(2), { id: 'a' }),
    )
  })

  it('keeps every value in range, even at extreme qualities', () => {
    for (const quality of [1, 10.5, 20, undefined]) {
      for (const coach of many(300, quality)) {
        for (const key of COACH_ATTRIBUTE_KEYS) {
          expect(Number.isInteger(coach.attributes[key])).toBe(true)
          expect(coach.attributes[key]).toBeGreaterThanOrEqual(1)
          expect(coach.attributes[key]).toBeLessThanOrEqual(20)
        }
        expect(Number.isInteger(coach.hidden.reputation)).toBe(true)
        expect(coach.hidden.reputation).toBeGreaterThanOrEqual(1)
        expect(coach.hidden.reputation).toBeLessThanOrEqual(100)
        expect(coach.hidden.adaptability).toBeGreaterThanOrEqual(1)
        expect(coach.hidden.adaptability).toBeLessThanOrEqual(20)
        expect(coach.age).toBeGreaterThanOrEqual(35)
        expect(coach.age).toBeLessThanOrEqual(70)
      }
    }
  })

  it('starts unemployed, with the given id and a known archetype', () => {
    const coach = generateCoach(createRng(3), { id: 'coach-7' })
    expect(coach.id).toBe('coach-7')
    expect(coach.contract).toBeNull()
    expect(SYSTEM_ARCHETYPES).toContain(coach.archetype)
    expect(coach.firstName.length).toBeGreaterThan(0)
    expect(coach.lastName.length).toBeGreaterThan(0)
  })

  it('produces every archetype across a league-sized sample', () => {
    const archetypes = new Set(many(200).map((c) => c.archetype))
    expect(archetypes.size).toBe(SYSTEM_ARCHETYPES.length)
  })

  it('centers the attribute mean on the requested quality', () => {
    for (const quality of [6, 10.5, 15]) {
      expect(mean(many(400, quality).map(coachQuality))).toBeCloseTo(quality, 0)
    }
  })

  it('makes good coaches good across the board, with strengths and weaknesses', () => {
    const good = many(300, 15)
    const poor = many(300, 6)
    for (const key of COACH_ATTRIBUTE_KEYS) {
      expect(mean(good.map((c) => c.attributes[key]))).toBeGreaterThan(
        mean(poor.map((c) => c.attributes[key])) + 6,
      )
    }
    // Realistic spread: a typical coach's best and worst attributes are several points apart.
    const spreads = good.map((c) => {
      const values = COACH_ATTRIBUTE_KEYS.map((key) => c.attributes[key])
      return Math.max(...values) - Math.min(...values)
    })
    expect(mean(spreads)).toBeGreaterThan(4)
  })

  it('correlates each attribute with overall quality', () => {
    const coaches = many(1000)
    const quality = coaches.map(coachQuality)
    for (const key of COACH_ATTRIBUTE_KEYS) {
      expect(
        correlation(
          quality,
          coaches.map((c) => c.attributes[key]),
        ),
      ).toBeGreaterThan(0.4)
    }
  })

  it('correlates reputation with quality, but loosely', () => {
    const coaches = many(1000)
    const r = correlation(
      coaches.map(coachQuality),
      coaches.map((c) => c.hidden.reputation),
    )
    expect(r).toBeGreaterThan(0.5)
    // Not a copy of quality: overrated and underrated coaches must exist.
    expect(r).toBeLessThan(0.95)
  })

  it('draws adaptability independently of quality', () => {
    const coaches = many(1000)
    const r = correlation(
      coaches.map(coachQuality),
      coaches.map((c) => c.hidden.adaptability),
    )
    expect(Math.abs(r)).toBeLessThan(0.15)
  })
})

describe('drawCoachQuality', () => {
  it('stays inside the generation band and centers on the mean', () => {
    const rng = createRng(5)
    const draws = Array.from({ length: 2000 }, () => drawCoachQuality(rng))
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(4)
    expect(Math.max(...draws)).toBeLessThanOrEqual(17)
    expect(mean(draws)).toBeCloseTo(10.5, 0)
  })
})
