import { describe, expect, it } from 'vitest'
import type { TeamFinances } from '../../../src/core/finances/teamFinances.ts'
import { coachQuality } from '../../../src/core/staff/coachGenerator.ts'
import { MAX_CONTRACT_YEARS, salaryDemand } from '../../../src/core/staff/contracts.ts'
import {
  assignLeagueCoaches,
  generateCoachPool,
  startingPoolSize,
  teamCoachSpending,
} from '../../../src/core/staff/market.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { teamCoachCap } from '../../../src/core/finances/teamFinances.ts'
import { mean } from '../../helpers/simulation.ts'
import { spreadFinances, uniformFinances } from './financesFixture.ts'

const TEAM_IDS = Array.from({ length: 30 }, (_, i) => `T${i + 1}`)
const FINANCES = spreadFinances(TEAM_IDS)

describe('generateCoachPool', () => {
  it('generates the requested number of unemployed coaches with unique ids', () => {
    const pool = generateCoachPool(createRng(1), 14, 'S2-')
    expect(pool).toHaveLength(14)
    expect(pool.every((c) => c.contract === null)).toBe(true)
    expect(new Set(pool.map((c) => c.id)).size).toBe(14)
    expect(pool.every((c) => c.id.startsWith('S2-'))).toBe(true)
  })

  it('is deterministic', () => {
    expect(generateCoachPool(createRng(4), 10)).toEqual(generateCoachPool(createRng(4), 10))
  })
})

describe('assignLeagueCoaches', () => {
  it('gives every team a head coach under contract, all within the cap', () => {
    for (const rules of [PRO_RULES, FIBA_RULES]) {
      const market = assignLeagueCoaches(createRng(8), TEAM_IDS, rules, FINANCES)
      expect(Object.keys(market.headCoaches).sort()).toEqual([...TEAM_IDS].sort())
      for (const teamId of TEAM_IDS) {
        const coach = market.headCoaches[teamId]
        if (coach === undefined) throw new Error(`no coach for ${teamId}`)
        expect(coach.contract?.salary).toBe(salaryDemand(coach, rules))
        expect(coach.contract?.yearsRemaining).toBeGreaterThanOrEqual(1)
        expect(coach.contract?.yearsRemaining).toBeLessThanOrEqual(MAX_CONTRACT_YEARS)
        expect(teamCoachSpending(market, teamId)).toBeLessThanOrEqual(
          teamCoachCap(FINANCES[teamId] as TeamFinances, rules),
        )
      }
    }
  })

  it('leaves a pool of 10–15 unemployed coaches for a 30-team league', () => {
    const market = assignLeagueCoaches(createRng(8), TEAM_IDS, PRO_RULES, FINANCES)
    expect(market.pool.length).toBe(startingPoolSize(30))
    expect(market.pool.length).toBeGreaterThanOrEqual(10)
    expect(market.pool.length).toBeLessThanOrEqual(15)
    expect(market.pool.every((c) => c.contract === null)).toBe(true)
  })

  it('uses unique coach ids across teams and pool', () => {
    const market = assignLeagueCoaches(createRng(8), TEAM_IDS, PRO_RULES, FINANCES)
    const ids = [...Object.values(market.headCoaches), ...market.pool].map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is deterministic', () => {
    expect(assignLeagueCoaches(createRng(21), TEAM_IDS, PRO_RULES, FINANCES)).toEqual(
      assignLeagueCoaches(createRng(21), TEAM_IDS, PRO_RULES, FINANCES),
    )
  })

  it('leaves weaker coaches unemployed on average', () => {
    const employed: number[] = []
    const unemployed: number[] = []
    for (let seed = 0; seed < 20; seed++) {
      const market = assignLeagueCoaches(createRng(seed), TEAM_IDS, PRO_RULES, FINANCES)
      employed.push(...Object.values(market.headCoaches).map(coachQuality))
      unemployed.push(...market.pool.map(coachQuality))
    }
    expect(mean(unemployed)).toBeLessThan(mean(employed))
  })
})

describe('assignLeagueCoaches and team caps', () => {
  it('keeps every team within its own cap over many seeds, poor teams included', () => {
    for (let seed = 0; seed < 40; seed++) {
      const market = assignLeagueCoaches(createRng(seed), TEAM_IDS, PRO_RULES, FINANCES)
      for (const teamId of TEAM_IDS) {
        const cap = teamCoachCap(FINANCES[teamId] as TeamFinances, PRO_RULES)
        expect(teamCoachSpending(market, teamId)).toBeLessThanOrEqual(cap)
      }
    }
  })

  it('gives poor teams cheaper coaches than rich teams on average', () => {
    const poor: number[] = []
    const rich: number[] = []
    for (let seed = 0; seed < 40; seed++) {
      const market = assignLeagueCoaches(createRng(seed), TEAM_IDS, PRO_RULES, FINANCES)
      poor.push(teamCoachSpending(market, 'T1'))
      rich.push(teamCoachSpending(market, 'T30'))
    }
    expect(mean(poor)).toBeLessThan(mean(rich))
  })

  it('keeps ids unique when replacements are drawn, and stays deterministic', () => {
    const poorLeague = uniformFinances(TEAM_IDS, 1)
    const market = assignLeagueCoaches(createRng(3), TEAM_IDS, PRO_RULES, poorLeague)
    const ids = [...Object.values(market.headCoaches), ...market.pool].map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(market).toEqual(assignLeagueCoaches(createRng(3), TEAM_IDS, PRO_RULES, poorLeague))
  })

  it('throws if a team has no finances', () => {
    expect(() => assignLeagueCoaches(createRng(1), ['X'], PRO_RULES, {})).toThrow(RangeError)
  })
})

describe('teamCoachSpending', () => {
  it('is zero for a team without a head coach', () => {
    const market = assignLeagueCoaches(createRng(2), TEAM_IDS, PRO_RULES, FINANCES)
    expect(teamCoachSpending(market, 'nobody')).toBe(0)
  })
})
