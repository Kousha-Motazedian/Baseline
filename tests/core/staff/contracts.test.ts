import { describe, expect, it } from 'vitest'
import { generateCoach } from '../../../src/core/staff/coachGenerator.ts'
import {
  canAffordCoach,
  coachSpending,
  contractYears,
  contractYearsRange,
  isValidContractLength,
  offerContract,
  salaryDemand,
} from '../../../src/core/staff/contracts.ts'
import type { HeadCoach } from '../../../src/core/staff/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'

/** A generated coach with his reputation and age overridden. */
function coachWith(reputation: number, age = 50): HeadCoach {
  const coach = generateCoach(createRng(reputation * 7 + age), { id: 'c' })
  return { ...coach, age, hidden: { ...coach.hidden, reputation } }
}

/** A coach whose ten attributes average `mean` exactly (half at floor, half at ceiling of it). */
function coachAt(reputation: number, mean: number): HeadCoach {
  const low = Math.floor(mean)
  const highCount = Math.round((mean - low) * 10)
  const base = coachWith(reputation)
  const attributes = Object.fromEntries(
    Object.keys(base.attributes).map((key, i) => [key, i < highCount ? low + 1 : low]),
  ) as unknown as HeadCoach['attributes']
  return { ...base, attributes }
}

describe('coachCapRange', () => {
  it('is a positive, ordered range in both rule sets', () => {
    for (const rules of [PRO_RULES, FIBA_RULES]) {
      expect(rules.coachCapRange.min).toBeGreaterThan(0)
      expect(rules.coachCapRange.max).toBeGreaterThan(rules.coachCapRange.min)
    }
  })
})

describe('salaryDemand', () => {
  it('stays within the top of the cap range for every reputation and league', () => {
    for (const rules of [PRO_RULES, FIBA_RULES]) {
      for (let reputation = 1; reputation <= 100; reputation++) {
        const salary = salaryDemand(coachWith(reputation), rules)
        expect(salary).toBeGreaterThan(0)
        expect(salary).toBeLessThanOrEqual(rules.coachCapRange.max)
      }
    }
  })

  it('rises with reputation at fixed attributes', () => {
    let previous = 0
    for (let reputation = 1; reputation <= 100; reputation++) {
      const salary = salaryDemand(coachAt(reputation, 12), PRO_RULES)
      expect(salary).toBeGreaterThanOrEqual(previous)
      previous = salary
    }
  })

  it('rises with attributes at fixed reputation', () => {
    expect(salaryDemand(coachAt(50, 16), PRO_RULES)).toBeGreaterThan(
      salaryDemand(coachAt(50, 6), PRO_RULES),
    )
  })

  it('weighs reputation more than ability', () => {
    const famousBad = salaryDemand(coachAt(90, 5), PRO_RULES)
    const unknownGreat = salaryDemand(coachAt(10, 18), PRO_RULES)
    expect(famousBad).toBeGreaterThan(unknownGreat)
  })

  it('matches the design doc examples (pro league)', () => {
    expect(salaryDemand(coachAt(50, 10.5), PRO_RULES)).toBeCloseTo(4_900_000, -5)
    expect(salaryDemand(coachAt(25, 16), PRO_RULES)).toBeCloseTo(3_800_000, -5)
    expect(salaryDemand(coachAt(80, 14), PRO_RULES)).toBeCloseTo(9_400_000, -5)
    expect(salaryDemand(coachAt(100, 20), PRO_RULES)).toBe(15_000_000)
  })

  it('never goes above the range top, even for out-of-range inputs', () => {
    expect(salaryDemand(coachAt(500, 20), PRO_RULES)).toBe(PRO_RULES.coachCapRange.max)
  })

  it('asks the same of every team and scales with the league range', () => {
    const coach = coachAt(70, 12)
    const custom = {
      ...PRO_RULES,
      coachCapRange: { min: 12_000_000, max: 2 * PRO_RULES.coachCapRange.max },
    }
    expect(salaryDemand(coach, custom)).toBeCloseTo(2 * salaryDemand(coach, PRO_RULES), -4)
  })

  it('has a cheapest demand below the lowest team cap, so every team can hire', () => {
    for (const rules of [PRO_RULES, FIBA_RULES]) {
      const cheapest = salaryDemand(coachAt(1, 1), rules)
      expect(cheapest).toBeLessThan(rules.coachCapRange.min)
    }
  })
})

describe('contract length', () => {
  it('is always 1–5 seasons', () => {
    const rng = createRng(12)
    for (let i = 0; i < 500; i++) {
      const coach = generateCoach(rng, { id: `c${i}` })
      const years = contractYears(rng, coach)
      expect(isValidContractLength(years)).toBe(true)
      const range = contractYearsRange(coach)
      expect(years).toBeGreaterThanOrEqual(range.min)
      expect(years).toBeLessThanOrEqual(range.max)
    }
  })

  it('keeps veteran coaches on short deals', () => {
    expect(contractYearsRange(coachWith(90, 68)).max).toBeLessThanOrEqual(2)
  })

  it('rejects invalid lengths when offering a contract', () => {
    const coach = coachWith(50)
    expect(() => offerContract(coach, PRO_RULES, 0)).toThrow(RangeError)
    expect(() => offerContract(coach, PRO_RULES, 6)).toThrow(RangeError)
    expect(() => offerContract(coach, PRO_RULES, 2.5)).toThrow(RangeError)
    expect(offerContract(coach, PRO_RULES, 3)).toEqual({
      salary: salaryDemand(coach, PRO_RULES),
      yearsRemaining: 3,
    })
  })
})

describe('coach cap accounting', () => {
  it('counts only a signed head coach', () => {
    expect(coachSpending(undefined)).toBe(0)
    const coach = coachWith(50)
    expect(coachSpending(coach)).toBe(0)
    const signed = { ...coach, contract: { salary: 4_000_000, yearsRemaining: 2 } }
    expect(coachSpending(signed)).toBe(4_000_000)
  })

  it('allows spending up to the cap exactly, and no further', () => {
    const cap = 9_000_000
    expect(canAffordCoach(0, cap, cap)).toBe(true)
    expect(canAffordCoach(1, cap, cap)).toBe(false)
    expect(canAffordCoach(cap - 5_000_000, 5_000_000, cap)).toBe(true)
    expect(canAffordCoach(cap - 5_000_000, 5_000_001, cap)).toBe(false)
  })
})
