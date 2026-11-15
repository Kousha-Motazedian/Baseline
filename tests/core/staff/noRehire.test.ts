/** The AI never re-hires the coach it just fired (final review M2). */
import { describe, expect, it } from 'vitest'
import type { TeamFinances } from '../../../src/core/finances/teamFinances.ts'
import {
  aiHireCoach,
  chooseCoachToHire,
  clearFiredHistory,
  fireCoach,
  hireCoach,
} from '../../../src/core/staff/hiring.ts'
import { assignLeagueCoaches } from '../../../src/core/staff/market.ts'
import type { CoachMarket } from '../../../src/core/staff/market.ts'
import type { HeadCoach } from '../../../src/core/staff/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { PRO_RULES } from '../../../src/core/world/rules.ts'
import { spreadFinances } from './financesFixture.ts'

const TEAM_IDS = Array.from({ length: 30 }, (_, i) => `T${i + 1}`)
const FINANCES = spreadFinances(TEAM_IDS)

/** A team's finances from the shared spread. */
function fin(teamId: string): TeamFinances {
  return FINANCES[teamId] as TeamFinances
}

/** A fresh league from a seed. */
function league(seed: number): CoachMarket {
  return assignLeagueCoaches(createRng(seed), TEAM_IDS, PRO_RULES, FINANCES)
}

/** A team's coach id. */
function coachId(market: CoachMarket, teamId: string): string {
  return (market.headCoaches[teamId] as HeadCoach).id
}

describe('no boomerang hires', () => {
  it('starts with an empty fired history and records firings', () => {
    const market = league(1)
    expect(market.firedBy).toEqual({})
    const fired = coachId(market, 'T5')
    expect(fireCoach(market, 'T5').firedBy).toEqual({ T5: [fired] })
    expect(market.firedBy).toEqual({})
  })

  it('never re-hires the fired coach across many seeds and teams', () => {
    let rehires = 0
    for (let seed = 1; seed <= 40; seed++) {
      for (const teamId of ['T1', 'T10', 'T20', 'T30']) {
        const market = league(seed)
        const fired = coachId(market, teamId)
        const next = aiHireCoach(
          createRng(seed),
          fireCoach(market, teamId),
          teamId,
          PRO_RULES,
          fin(teamId),
        )
        if (next.headCoaches[teamId]?.id === fired) rehires++
      }
    }
    expect(rehires).toBe(0)
  })

  it('leaves the job vacant when the only affordable coach is the fired one', () => {
    const market = fireCoach(league(3), 'T30')
    const only: CoachMarket = {
      ...market,
      pool: market.pool.filter((c) => c.id === coachId(league(3), 'T30')),
    }
    expect(chooseCoachToHire(only, 'T30', PRO_RULES, fin('T30'))).toBeNull()
    expect(aiHireCoach(createRng(1), only, 'T30', PRO_RULES, fin('T30'))).toBe(only)
  })

  it('lets another team hire him', () => {
    const market = league(4)
    const fired = coachId(market, 'T30')
    const both = fireCoach(fireCoach(market, 'T30'), 'T29')
    const pool: CoachMarket = { ...both, pool: both.pool.filter((c) => c.id === fired) }
    expect(chooseCoachToHire(pool, 'T29', PRO_RULES, fin('T29'))?.id).toBe(fired)
    expect(chooseCoachToHire(pool, 'T30', PRO_RULES, fin('T30'))).toBeNull()
  })

  it('does not restrict the GM hireCoach path', () => {
    const market = league(5)
    const fired = coachId(market, 'T30')
    const next = hireCoach(fireCoach(market, 'T30'), 'T30', fired, PRO_RULES, fin('T30'), 3)
    expect(next.headCoaches['T30']?.id).toBe(fired)
  })

  it('allows a re-hire once the history is cleared', () => {
    const market = league(6)
    const fired = coachId(market, 'T30')
    const after = fireCoach(market, 'T30')
    const only: CoachMarket = { ...after, pool: after.pool.filter((c) => c.id === fired) }
    expect(chooseCoachToHire(only, 'T30', PRO_RULES, fin('T30'))).toBeNull()
    const cleared = clearFiredHistory(only)
    expect(cleared.firedBy).toEqual({})
    expect(chooseCoachToHire(cleared, 'T30', PRO_RULES, fin('T30'))?.id).toBe(fired)
  })

  it('is deterministic', () => {
    const run = (): CoachMarket =>
      aiHireCoach(createRng(9), fireCoach(league(7), 'T12'), 'T12', PRO_RULES, fin('T12'))
    expect(run()).toEqual(run())
  })

  it('keeps A excluded after B hires and then fires the same coach', () => {
    const market = league(8)
    const x = coachId(market, 'T30')
    const afterA = fireCoach(market, 'T30')
    const afterB = fireCoach(
      hireCoach(fireCoach(afterA, 'T29'), 'T29', x, PRO_RULES, fin('T29'), 3),
      'T29',
    )
    expect(afterB.firedBy['T30']).toEqual([x])
    expect(afterB.firedBy['T29']).toContain(x)
    const only: CoachMarket = { ...afterB, pool: afterB.pool.filter((c) => c.id === x) }
    expect(chooseCoachToHire(only, 'T30', PRO_RULES, fin('T30'))).toBeNull()
    expect(chooseCoachToHire(only, 'T29', PRO_RULES, fin('T29'))).toBeNull()
    expect(chooseCoachToHire(only, 'T28', PRO_RULES, fin('T28'))?.id).toBe(x)
  })

  it('does not mutate inputs and firedBy survives a JSON round trip', () => {
    const market = league(9)
    const before = JSON.stringify(market)
    const fired = fireCoach(market, 'T3')
    aiHireCoach(createRng(2), fired, 'T3', PRO_RULES, fin('T3'))
    clearFiredHistory(fired)
    expect(JSON.stringify(market)).toBe(before)
    const afterFire = JSON.stringify(fired)
    hireCoach(fired, 'T3', (fired.pool[0] as HeadCoach).id, PRO_RULES, fin('T3'), 2)
    expect(JSON.stringify(fired)).toBe(afterFire)
    expect(JSON.parse(JSON.stringify(fired.firedBy))).toEqual(fired.firedBy)
    expect(JSON.parse(JSON.stringify(fired))).toEqual(fired)
    expect(clearFiredHistory(fired).pool).toBe(fired.pool)
  })

  it('records repeated firings in order and hireCoach preserves firedBy', () => {
    const market = league(10)
    const a = coachId(market, 'T2')
    const f1 = fireCoach(market, 'T2')
    const hired = hireCoach(f1, 'T2', (f1.pool[0] as HeadCoach).id, PRO_RULES, fin('T2'), 2)
    expect(hired.firedBy).toEqual({ T2: [a] })
    const f2 = fireCoach(hired, 'T2')
    expect(f2.firedBy['T2']).toEqual([a, (f1.pool[0] as HeadCoach).id])
  })
})
