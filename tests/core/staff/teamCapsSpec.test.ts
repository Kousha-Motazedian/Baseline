/**
 * Independent spec checks for team finances, coach caps, salary demand and league assignment
 * (docs/design/coaches.md, section 6): formulas, FIBA rules, the all-redraws-fail path and realism.
 */
import { describe, expect, it } from 'vitest'
import { createRng } from '../../../src/core/shared/rng.ts'
import {
  generateTeamFinances,
  teamCoachCap,
  type TeamFinances,
} from '../../../src/core/finances/teamFinances.ts'
import { salaryDemand } from '../../../src/core/staff/contracts.ts'
import { coachQuality } from '../../../src/core/staff/coachGenerator.ts'
import { chooseCoachToHire } from '../../../src/core/staff/hiring.ts'
import {
  assignLeagueCoaches,
  startingPoolSize,
  teamCoachSpending,
} from '../../../src/core/staff/market.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { makeCoach } from '../../helpers/coaching.ts'
import { financesAt } from './financesFixture.ts'

const IDS = Array.from({ length: 30 }, (_, i) => `T${i + 1}`)

/** A team's cap for market size m and owner wealth o. */
function capFor(m: number, o: number, rules = PRO_RULES): number {
  return teamCoachCap({ teamId: 'X', marketSize: m, ownerWealth: o }, rules)
}

describe('team finances spec numbers', () => {
  it('has a standard deviation near 4 (slightly less after clamping and rounding)', () => {
    const all = Object.values(
      generateTeamFinances(
        createRng(3),
        Array.from({ length: 20000 }, (_, i) => `t${i}`),
      ),
    )
    const sd = (xs: number[]): number => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
    }
    expect(sd(all.map((f) => f.marketSize))).toBeGreaterThan(3.7)
    expect(sd(all.map((f) => f.marketSize))).toBeLessThan(4.1)
    expect(sd(all.map((f) => f.ownerWealth))).toBeGreaterThan(3.7)
    expect(sd(all.map((f) => f.ownerWealth))).toBeLessThan(4.1)
  })

  it('computes the cap as min + (max - min) x (power - 1) / 19, rounded to 1,000', () => {
    expect(capFor(10.5, 10.5)).toBe(10_500_000)
    expect(capFor(1, 20)).toBe(10_500_000)
    expect(capFor(1, 2)).toBe(6_000_000 + Math.round((9_000_000 * (0.5 / 19)) / 1000) * 1000)
    expect(capFor(20, 20, FIBA_RULES)).toBe(1_500_000)
    expect(capFor(10, 11, FIBA_RULES)).toBe(1_050_000)
    expect(capFor(20, 20) / capFor(1, 1)).toBe(2.5)
  })
})

describe('salary demand spec numbers', () => {
  it('follows 0.7 reputation / 0.3 ability exactly', () => {
    const c = makeCoach({ reputation: 50 })
    const value = 0.7 * 0.5 + 0.3 * ((coachQuality(c) - 1) / 19)
    const expected = Math.round((15_000_000 * (0.1 + 0.9 * value ** 2)) / 1000) * 1000
    expect(salaryDemand(c, PRO_RULES)).toBe(expected)
  })
})

describe('assignLeagueCoaches edge cases', () => {
  it('respects every team cap under FIBA rules, with a pool of 12', () => {
    const finances = generateTeamFinances(createRng(5), IDS)
    for (let seed = 0; seed < 20; seed++) {
      const market = assignLeagueCoaches(createRng(seed), IDS, FIBA_RULES, finances)
      expect(market.pool).toHaveLength(startingPoolSize(30))
      for (const id of IDS) {
        expect(teamCoachSpending(market, id)).toBeLessThanOrEqual(
          teamCoachCap(finances[id] as TeamFinances, FIBA_RULES),
        )
      }
    }
  })

  it('handles an all-poorest and an all-richest league', () => {
    for (const rating of [1, 20]) {
      const finances = Object.fromEntries(IDS.map((id) => [id, financesAt(id, rating)]))
      const market = assignLeagueCoaches(createRng(9), IDS, PRO_RULES, finances)
      const cap = rating === 1 ? 6_000_000 : 15_000_000
      for (const id of IDS) expect(teamCoachSpending(market, id)).toBeLessThanOrEqual(cap)
      const ids = [...Object.values(market.headCoaches), ...market.pool].map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('throws for a missing finances entry even when it is not the first team', () => {
    const finances = Object.fromEntries(IDS.slice(0, 5).map((id) => [id, financesAt(id, 10)]))
    expect(() => assignLeagueCoaches(createRng(1), IDS, PRO_RULES, finances)).toThrow(RangeError)
  })

  it('KNOWN BEHAVIOUR: when no replacement fits the cap (impossible rules) the team overspends silently', () => {
    // Real rules can't reach this: the cheapest demand (1.5M) is far below the lowest cap (6M).
    const impossible = { ...PRO_RULES, coachCapRange: { min: 1_000, max: 20_000 } }
    const finances = Object.fromEntries(IDS.map((id) => [id, financesAt(id, 1)]))
    const market = assignLeagueCoaches(createRng(2), IDS, impossible, finances)
    expect(Object.keys(market.headCoaches)).toHaveLength(30)
    for (const id of IDS) {
      expect(teamCoachSpending(market, id)).toBeGreaterThan(
        teamCoachCap(finances[id] as TeamFinances, impossible),
      )
    }
  })
})

describe('AI hiring picks the best affordable coach by reputation', () => {
  it('matches a brute-force best over the affordable pool', () => {
    const finances = financesAt('T1', 4)
    const cap = teamCoachCap(finances, PRO_RULES)
    const pool = [10, 30, 55, 70, 85, 95].map((reputation, i) => ({
      ...makeCoach({ reputation }),
      id: `P${i}`,
    }))
    const market = { headCoaches: {}, pool }
    const affordable = pool.filter((c) => salaryDemand(c, PRO_RULES) <= cap)
    const best = [...affordable].sort((a, b) => b.hidden.reputation - a.hidden.reputation)[0]
    expect(affordable.length).toBeLessThan(pool.length)
    expect(chooseCoachToHire(market, 'T1', PRO_RULES, finances)?.id).toBe(best?.id)
  })
})

describe('realism of a generated pro league', () => {
  it('lets the richest team afford everyone, the poorest most coaches, and sends famous coaches to rich teams', () => {
    let famous = 0
    let famousRich = 0
    let poorShare = 0
    const seeds = 60
    for (let seed = 1; seed <= seeds; seed++) {
      const rng = createRng(seed)
      const finances = generateTeamFinances(rng, IDS)
      const market = assignLeagueCoaches(rng, IDS, PRO_RULES, finances)
      const caps = IDS.map((id) => ({
        id,
        cap: teamCoachCap(finances[id] as TeamFinances, PRO_RULES),
      }))
      caps.sort((a, b) => a.cap - b.cap)
      const everyone = [...Object.values(market.headCoaches), ...market.pool]
      const demands = everyone.map((c) => salaryDemand(c, PRO_RULES))
      expect(demands.filter((d) => d <= (caps[29]?.cap ?? 0)).length).toBeGreaterThanOrEqual(
        demands.length - 1,
      )
      poorShare += demands.filter((d) => d <= (caps[0]?.cap ?? 0)).length / demands.length
      const richHalf = new Set(caps.slice(15).map((c) => c.id))
      for (const [id, coach] of Object.entries(market.headCoaches)) {
        if (coach.hidden.reputation < 80) continue
        famous++
        if (richHalf.has(id)) famousRich++
      }
    }
    expect(famousRich / famous).toBeGreaterThan(0.65)
    expect(poorShare / seeds).toBeGreaterThan(0.75)
    expect(poorShare / seeds).toBeLessThan(0.97)
  })
})
