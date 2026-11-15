/**
 * Edge cases for the coach model: out-of-range inputs, extreme coaches, the cap under AI hiring,
 * and sim-level independence from reputation.
 */
import { describe, expect, it } from 'vitest'
import { simulateGame } from '../../../src/core/match/game.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import {
  contractYears,
  contractYearsRange,
  salaryDemand,
} from '../../../src/core/staff/contracts.ts'
import { aiHireCoach, fireCoach, hireCoach } from '../../../src/core/staff/hiring.ts'
import { assignLeagueCoaches, teamCoachSpending } from '../../../src/core/staff/market.ts'
import { coachingInputs } from '../../../src/core/tactics/coaching.ts'
import { SYSTEM_ARCHETYPES, archetypeSystem } from '../../../src/core/tactics/system.ts'
import { teamCoachCap } from '../../../src/core/finances/teamFinances.ts'
import type { TeamFinances } from '../../../src/core/finances/teamFinances.ts'
import { PRO_RULES } from '../../../src/core/world/rules.ts'
import { makeCoach } from '../../helpers/coaching.ts'
import { generatedPair } from '../../helpers/fixtures.ts'
import { financesAt, spreadFinances } from './financesFixture.ts'

const TEAMS = Array.from({ length: 30 }, (_, i) => `T${i + 1}`)
const FINANCES = spreadFinances(TEAMS)

/** A team's finances from the shared spread. */
function fin(teamId: string): TeamFinances {
  return FINANCES[teamId] as TeamFinances
}

/** All ten attributes at the maximum. */
const ALL_TWENTY = Object.fromEntries(Object.keys(makeCoach().attributes).map((key) => [key, 20]))

/** All ten attributes at the minimum. */
const ALL_ONE = Object.fromEntries(Object.keys(makeCoach().attributes).map((key) => [key, 1]))

describe('salary and contract edge cases', () => {
  it('clamps out-of-range reputations into the cap', () => {
    expect(salaryDemand(makeCoach({ reputation: 500, attributes: ALL_TWENTY }), PRO_RULES)).toBe(
      PRO_RULES.coachCapRange.max,
    )
    expect(
      salaryDemand(makeCoach({ reputation: -50, attributes: ALL_ONE }), PRO_RULES),
    ).toBeLessThanOrEqual(PRO_RULES.coachCapRange.max * 0.1)
  })

  it('gives an old, famous coach exactly a two-year deal', () => {
    const coach = { ...makeCoach({ reputation: 95 }), age: 70 }
    expect(contractYearsRange(coach)).toEqual({ min: 2, max: 2 })
    expect(contractYears(createRng(1), coach)).toBe(2)
  })

  it('gives a young unknown coach the full 1–5 range', () => {
    expect(contractYearsRange({ ...makeCoach({ reputation: 10 }), age: 36 })).toEqual({
      min: 1,
      max: 5,
    })
  })
})

describe('league-wide hiring under the cap', () => {
  it('keeps every team within the cap through repeated fire and AI-hire cycles', () => {
    const rng = createRng(21)
    let market = assignLeagueCoaches(rng, TEAMS, PRO_RULES, FINANCES)
    for (const teamId of TEAMS.slice(0, 12)) {
      market = fireCoach(market, teamId)
      market = aiHireCoach(rng, market, teamId, PRO_RULES, fin(teamId))
    }
    for (const teamId of TEAMS) {
      expect(teamCoachSpending(market, teamId)).toBeLessThanOrEqual(
        teamCoachCap(fin(teamId), PRO_RULES),
      )
    }
    const ids = [...Object.values(market.headCoaches), ...market.pool].map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.keys(market.headCoaches)).toHaveLength(30)
  })

  it('can leave a vacancy unfilled when the team cap is below every demand', () => {
    const market = fireCoach(assignLeagueCoaches(createRng(3), TEAMS, PRO_RULES, FINANCES), 'T1')
    // A tiny pro range makes every cap smaller than the cheapest demand: the cap now binds.
    const tiny = { ...PRO_RULES, coachCapRange: { min: 1_000, max: 20_000 } }
    const cap = teamCoachCap(financesAt('T1', 1), tiny)
    const cheapest = Math.min(...market.pool.map((c) => salaryDemand(c, tiny)))
    expect(cheapest).toBeGreaterThan(cap)
    expect(aiHireCoach(createRng(1), market, 'T1', tiny, financesAt('T1', 1))).toBe(market)
  })

  it('every team can always hire, since the cheapest demand is below the lowest cap', () => {
    const cheapest = salaryDemand(
      makeCoach({
        reputation: 1,
        attributes: {
          offensiveCoaching: 1,
          defensiveCoaching: 1,
          tacticalKnowledge: 1,
          gameManagement: 1,
          rotationManagement: 1,
          playerEvaluation: 1,
          motivation: 1,
          playerDevelopment: 1,
          discipline: 1,
          worksWithYouth: 1,
        },
      }),
      PRO_RULES,
    )
    expect(cheapest).toBeLessThan(teamCoachCap(financesAt('T1', 1), PRO_RULES))
  })

  it('refuses to fire twice and to hire a coach already employed', () => {
    const market = assignLeagueCoaches(createRng(4), TEAMS, PRO_RULES, FINANCES)
    const fired = fireCoach(market, 'T1')
    expect(() => fireCoach(fired, 'T1')).toThrow(RangeError)
    const employed = (market.headCoaches['T2'] ?? makeCoach()).id
    expect(() => hireCoach(fired, 'T1', employed, PRO_RULES, fin('T1'), 2)).toThrow(RangeError)
  })

  it('handles empty leagues', () => {
    const market = assignLeagueCoaches(createRng(1), [], PRO_RULES, {})
    expect(market.headCoaches).toEqual({})
    expect(market.pool).toEqual([])
  })
})

describe('coaching inputs at the extremes', () => {
  const worst = makeCoach({
    attributes: { offensiveCoaching: 1, defensiveCoaching: 1, tacticalKnowledge: 1 },
    adaptability: 1,
  })
  const best = makeCoach({
    attributes: { offensiveCoaching: 20, defensiveCoaching: 20, tacticalKnowledge: 20 },
    adaptability: 20,
  })

  it('stays finite and small for every archetype override, at both extremes', () => {
    for (const archetype of SYSTEM_ARCHETYPES) {
      for (const coach of [worst, best]) {
        const inputs = coachingInputs(coach, archetypeSystem(archetype))
        expect(Number.isFinite(inputs.offensiveExecution)).toBe(true)
        expect(Math.abs(inputs.offensiveExecution)).toBeLessThan(0.1)
        expect(Math.abs(inputs.defensiveExecution)).toBeLessThan(0.1)
      }
    }
  })

  it('never makes an override better than running the preferred system', () => {
    for (const archetype of SYSTEM_ARCHETYPES) {
      const own = coachingInputs(worst, worst.preferredSystem)
      const overridden = coachingInputs(worst, archetypeSystem(archetype))
      expect(overridden.offensiveExecution).toBeLessThanOrEqual(own.offensiveExecution)
      expect(overridden.defensiveExecution).toBeLessThanOrEqual(own.defensiveExecution)
    }
  })
})

describe('reputation has no effect on a played game', () => {
  it('plays the identical game for coaches that differ only in reputation', () => {
    const [home, away] = generatedPair(8)
    const play = (reputation: number): string => {
      const coach = makeCoach({ reputation })
      const coaching = coachingInputs(coach, archetypeSystem('paceAndSpace'))
      return JSON.stringify(
        simulateGame({ home: { ...home, coaching }, away, rules: PRO_RULES, seed: 12 }),
      )
    }
    expect(play(1)).toBe(play(100))
  })
})
