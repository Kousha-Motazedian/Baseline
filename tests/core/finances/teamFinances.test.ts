import { describe, expect, it } from 'vitest'
import { createRng } from '../../../src/core/shared/rng.ts'
import {
  financialPower,
  generateTeamFinances,
  teamCoachCap,
  type TeamFinances,
} from '../../../src/core/finances/teamFinances.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'

const ids = Array.from({ length: 5000 }, (_, i) => `T${i}`)

/** Builds finances with the given values. */
function fin(marketSize: number, ownerWealth: number): TeamFinances {
  return { teamId: 'X', marketSize, ownerWealth }
}

describe('generateTeamFinances', () => {
  const all = Object.values(generateTeamFinances(createRng(1), ids))

  it('gives integer values from 1 to 20 for every team', () => {
    expect(all).toHaveLength(ids.length)
    for (const f of all) {
      for (const v of [f.marketSize, f.ownerWealth]) {
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(1)
        expect(v).toBeLessThanOrEqual(20)
      }
    }
  })

  it('is deterministic by seed', () => {
    expect(generateTeamFinances(createRng(7), ids)).toEqual(generateTeamFinances(createRng(7), ids))
    expect(generateTeamFinances(createRng(7), ids)).not.toEqual(
      generateTeamFinances(createRng(8), ids),
    )
  })

  it('has mean about 10.5 and correlation about 0.3', () => {
    const n = all.length
    const m = all.map((f) => f.marketSize)
    const o = all.map((f) => f.ownerWealth)
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / n
    const mm = mean(m)
    const mo = mean(o)
    expect(mm).toBeCloseTo(10.5, 0)
    expect(mo).toBeCloseTo(10.5, 0)
    let cov = 0
    let vm = 0
    let vo = 0
    for (let i = 0; i < n; i++) {
      cov += (m[i] - mm) * (o[i] - mo)
      vm += (m[i] - mm) ** 2
      vo += (o[i] - mo) ** 2
    }
    const r = cov / Math.sqrt(vm * vo)
    expect(r).toBeGreaterThan(0.2)
    expect(r).toBeLessThan(0.4)
  })

  it('keys by team id', () => {
    const result = generateTeamFinances(createRng(2), ['A', 'B'])
    expect(result.A.teamId).toBe('A')
    expect(result.B.teamId).toBe('B')
  })
})

describe('teamCoachCap', () => {
  it('equals the range minimum at power 1 and maximum at power 20', () => {
    expect(teamCoachCap(fin(1, 1), PRO_RULES)).toBe(6_000_000)
    expect(teamCoachCap(fin(20, 20), PRO_RULES)).toBe(15_000_000)
    expect(teamCoachCap(fin(1, 1), FIBA_RULES)).toBe(600_000)
    expect(teamCoachCap(fin(20, 20), FIBA_RULES)).toBe(1_500_000)
  })

  it('computes financial power as the average', () => {
    expect(financialPower(fin(5, 10))).toBe(7.5)
  })

  it('averages about 10.5M for a generated pro league', () => {
    const all = Object.values(generateTeamFinances(createRng(3), ids))
    const avg = all.reduce((s, f) => s + teamCoachCap(f, PRO_RULES), 0) / all.length
    expect(avg).toBeGreaterThan(10_300_000)
    expect(avg).toBeLessThan(10_700_000)
  })

  it('rounds to 1,000 and stays within the range', () => {
    for (const f of Object.values(generateTeamFinances(createRng(4), ids.slice(0, 500)))) {
      const cap = teamCoachCap(f, PRO_RULES)
      expect(cap % 1000).toBe(0)
      expect(cap).toBeGreaterThanOrEqual(6_000_000)
      expect(cap).toBeLessThanOrEqual(15_000_000)
    }
  })
})
