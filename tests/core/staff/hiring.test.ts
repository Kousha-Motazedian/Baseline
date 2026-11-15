import { describe, expect, it } from 'vitest'
import type { TeamFinances } from '../../../src/core/finances/teamFinances.ts'
import { generateCoach } from '../../../src/core/staff/coachGenerator.ts'
import { salaryDemand } from '../../../src/core/staff/contracts.ts'
import {
  aiHireCoach,
  canTeamAffordCoach,
  chooseCoachToHire,
  DEFAULT_FIRING_TOLERANCE,
  fireCoach,
  hireCoach,
  shouldFireCoach,
} from '../../../src/core/staff/hiring.ts'
import type { CoachMarket } from '../../../src/core/staff/market.ts'
import { assignLeagueCoaches, teamCoachSpending } from '../../../src/core/staff/market.ts'
import type { HeadCoach } from '../../../src/core/staff/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { teamCoachCap } from '../../../src/core/finances/teamFinances.ts'
import { PRO_RULES } from '../../../src/core/world/rules.ts'
import { financesAt, spreadFinances } from './financesFixture.ts'

const TEAM_IDS = Array.from({ length: 30 }, (_, i) => `T${i + 1}`)
const FINANCES = spreadFinances(TEAM_IDS)

/** A team's finances from the shared 30-team spread (T1 poorest, T30 richest). */
function fin(teamId: string): TeamFinances {
  return FINANCES[teamId] as TeamFinances
}

/** A fresh 30-team market from a fixed seed. */
function league(seed = 5): CoachMarket {
  return assignLeagueCoaches(createRng(seed), TEAM_IDS, PRO_RULES, FINANCES)
}

/** An unemployed coach with a set reputation and quality level. */
function candidate(id: string, reputation: number, quality: number): HeadCoach {
  const coach = generateCoach(createRng(id.length * 101 + reputation), { id, quality })
  return { ...coach, hidden: { ...coach.hidden, reputation } }
}

describe('fireCoach', () => {
  it('returns the coach to the pool unemployed and leaves the job vacant', () => {
    const market = league()
    const coach = market.headCoaches['T1'] as HeadCoach
    const next = fireCoach(market, 'T1')
    expect(next.headCoaches['T1']).toBeUndefined()
    expect(next.pool).toHaveLength(market.pool.length + 1)
    expect(next.pool.find((c) => c.id === coach.id)).toEqual({ ...coach, contract: null })
    expect(Object.keys(next.headCoaches)).toHaveLength(29)
  })

  it('is free: the fired coach no longer counts against the cap', () => {
    const next = fireCoach(league(), 'T1')
    expect(teamCoachSpending(next, 'T1')).toBe(0)
  })

  it('does not mutate the input market', () => {
    const market = league()
    const snapshot = structuredClone(market)
    fireCoach(market, 'T1')
    expect(market).toEqual(snapshot)
  })

  it('throws when the team has no coach', () => {
    const next = fireCoach(league(), 'T1')
    expect(() => fireCoach(next, 'T1')).toThrow(RangeError)
  })
})

describe('hireCoach', () => {
  it('takes the coach from the pool and signs him at his demand', () => {
    const market = fireCoach(league(), 'T3')
    const target = market.pool[0] as HeadCoach
    const next = hireCoach(market, 'T3', target.id, PRO_RULES, fin('T3'), 3)
    expect(next.pool.some((c) => c.id === target.id)).toBe(false)
    expect(next.pool).toHaveLength(market.pool.length - 1)
    expect(next.headCoaches['T3']?.id).toBe(target.id)
    expect(next.headCoaches['T3']?.contract).toEqual({
      salary: salaryDemand(target, PRO_RULES),
      yearsRemaining: 3,
    })
    expect(teamCoachSpending(next, 'T3')).toBeLessThanOrEqual(teamCoachCap(fin('T3'), PRO_RULES))
  })

  it('lets a team re-hire the coach it just fired, at no extra cost', () => {
    const market = league()
    const coach = market.headCoaches['T2'] as HeadCoach
    const next = hireCoach(fireCoach(market, 'T2'), 'T2', coach.id, PRO_RULES, fin('T2'), 2)
    expect(teamCoachSpending(next, 'T2')).toBe(salaryDemand(coach, PRO_RULES))
  })

  it('does not mutate the input market', () => {
    const market = fireCoach(league(), 'T3')
    const snapshot = structuredClone(market)
    hireCoach(market, 'T3', (market.pool[0] as HeadCoach).id, PRO_RULES, fin('T3'), 2)
    expect(market).toEqual(snapshot)
  })

  it('refuses a filled job, an unknown coach and a bad contract length', () => {
    const market = league()
    const poolId = (market.pool[0] as HeadCoach).id
    expect(() => hireCoach(market, 'T1', poolId, PRO_RULES, fin('T1'), 2)).toThrow(RangeError)
    const vacant = fireCoach(market, 'T1')
    expect(() => hireCoach(vacant, 'T1', 'nobody', PRO_RULES, fin('T1'), 2)).toThrow(RangeError)
    expect(() => hireCoach(vacant, 'T1', poolId, PRO_RULES, fin('T1'), 6)).toThrow(RangeError)
  })

  it('respects the team cap', () => {
    const vacant = fireCoach(league(), 'T1')
    // Even the poorest team's cap exceeds the cheapest demands, so a vacant job has a fit.
    expect(vacant.pool.some((c) => canTeamAffordCoach(vacant, 'T1', c, PRO_RULES, fin('T1')))).toBe(
      true,
    )
    // A team still paying its coach can't add a full-cap salary on top.
    const famous = candidate('star', 100, 20)
    expect(canTeamAffordCoach(league(), 'T30', famous, PRO_RULES, fin('T30'))).toBe(false)
  })

  it('lets a rich team afford a famous coach that a poor team cannot', () => {
    const famous = candidate('star', 90, 16)
    const demand = salaryDemand(famous, PRO_RULES)
    const empty: CoachMarket = { headCoaches: {}, pool: [famous], firedBy: {} }
    const poor = financesAt('P', 1)
    const rich = financesAt('R', 20)
    expect(demand).toBeGreaterThan(teamCoachCap(poor, PRO_RULES))
    expect(demand).toBeLessThanOrEqual(teamCoachCap(rich, PRO_RULES))
    expect(canTeamAffordCoach(empty, 'P', famous, PRO_RULES, poor)).toBe(false)
    expect(canTeamAffordCoach(empty, 'R', famous, PRO_RULES, rich)).toBe(true)
    expect(() => hireCoach(empty, 'P', 'star', PRO_RULES, poor, 3)).toThrow(RangeError)
    expect(hireCoach(empty, 'R', 'star', PRO_RULES, rich, 3).headCoaches['R']?.id).toBe('star')
  })
})

describe('AI hiring', () => {
  it('ranks by reputation first, then quality', () => {
    const market: CoachMarket = {
      headCoaches: {},
      firedBy: {},
      pool: [
        candidate('quiet-genius', 40, 17),
        candidate('famous-a', 80, 8),
        candidate('famous-b', 80, 14),
      ],
    }
    expect(chooseCoachToHire(market, 'T30', PRO_RULES, fin('T30'))?.id).toBe('famous-b')
  })

  it('returns null when the pool is empty or nobody is affordable', () => {
    expect(
      chooseCoachToHire({ headCoaches: {}, pool: [], firedBy: {} }, 'T1', PRO_RULES, fin('T1')),
    ).toBeNull()
    // T30 still has its coach, so a full-cap coach doesn't fit next to him.
    const market: CoachMarket = { ...league(), pool: [candidate('star', 100, 20)] }
    expect(chooseCoachToHire(market, 'T30', PRO_RULES, fin('T30'))).toBeNull()
    expect(aiHireCoach(createRng(1), market, 'T30', PRO_RULES, fin('T30'))).toBe(market)
  })

  it('skips a famous coach the team cannot afford and takes the best one it can', () => {
    const market: CoachMarket = {
      headCoaches: {},
      firedBy: {},
      pool: [candidate('star', 100, 20), candidate('solid', 40, 12)],
    }
    const poor = financesAt('P', 1)
    expect(chooseCoachToHire(market, 'P', PRO_RULES, poor)?.id).toBe('solid')
    expect(chooseCoachToHire(market, 'R', PRO_RULES, financesAt('R', 20))?.id).toBe('star')
  })

  it('never exceeds a team cap across every team and vacancy', () => {
    for (const seed of [1, 2, 3]) {
      let market = league(seed)
      const rng = createRng(seed)
      for (const teamId of TEAM_IDS) {
        market = aiHireCoach(rng, fireCoach(market, teamId), teamId, PRO_RULES, fin(teamId))
        expect(teamCoachSpending(market, teamId)).toBeLessThanOrEqual(
          teamCoachCap(fin(teamId), PRO_RULES),
        )
      }
    }
  })

  it('fills a vacancy with the chosen coach on a valid contract', () => {
    const market = fireCoach(league(), 'T4')
    const choice = chooseCoachToHire(market, 'T4', PRO_RULES, fin('T4')) as HeadCoach
    const next = aiHireCoach(createRng(1), market, 'T4', PRO_RULES, fin('T4'))
    const hired = next.headCoaches['T4']
    expect(hired?.id).toBe(choice.id)
    expect(hired?.contract?.yearsRemaining).toBeGreaterThanOrEqual(1)
    expect(hired?.contract?.yearsRemaining).toBeLessThanOrEqual(5)
    expect(teamCoachSpending(next, 'T4')).toBeLessThanOrEqual(teamCoachCap(fin('T4'), PRO_RULES))
  })
})

describe('shouldFireCoach', () => {
  const expectations = { expectedWinPct: 0.6, tolerance: DEFAULT_FIRING_TOLERANCE }

  it('fires only when the team falls clearly short', () => {
    expect(shouldFireCoach({ wins: 30, losses: 52 }, expectations)).toBe(true)
    expect(shouldFireCoach({ wins: 40, losses: 42 }, expectations)).toBe(false)
    expect(shouldFireCoach({ wins: 60, losses: 22 }, expectations)).toBe(false)
  })

  it('never fires before any games are played', () => {
    expect(shouldFireCoach({ wins: 0, losses: 0 }, expectations)).toBe(false)
  })
})
