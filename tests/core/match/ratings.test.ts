import { describe, expect, it } from 'vitest'
import {
  ballPressureSkill,
  ballSecuritySkill,
  bestRimProtector,
  blend,
  blockSkill,
  defensiveReboundSkill,
  defensiveSkill,
  heightEdge,
  offensiveReboundSkill,
  offensiveSkill,
  rimProtectionSkill,
} from '../../../src/core/match/ratings.ts'
import { PLAY_TYPES } from '../../../src/core/match/types.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { makePlayer } from '../../helpers/fixtures.ts'

/** Every composite skill function, so range properties can be checked on all of them at once. */
const COMPOSITES: readonly ((p: Player) => number)[] = [
  ...PLAY_TYPES.map((t) => (p: Player) => offensiveSkill(p, t)),
  ...PLAY_TYPES.map((t) => (p: Player) => defensiveSkill(p, t)),
  rimProtectionSkill,
  ballSecuritySkill,
  ballPressureSkill,
  offensiveReboundSkill,
  defensiveReboundSkill,
  blockSkill,
]

describe('blend', () => {
  it('is a weighted average (weights need not sum to 1)', () => {
    const p = makePlayer({ id: 'a', attributes: { driving: 20, finishing: 10 } })
    expect(blend(p, { driving: 1, finishing: 1 })).toBe(15)
    expect(blend(p, { driving: 3, finishing: 1 })).toBe(17.5)
  })
})

describe('composite skills', () => {
  it('return the flat rating for a flat player (weights are normalized)', () => {
    for (const rating of [1, 7, 10.5, 20]) {
      const p = makePlayer({ id: 'a', rating })
      for (const skill of COMPOSITES) expect(skill(p)).toBeCloseTo(rating, 10)
    }
  })

  it('shift by exactly +k when every attribute shifts by +k (league invariance building block)', () => {
    const base = makePlayer({ id: 'a', attributes: { driving: 4, threePoint: 17, strength: 8 } })
    const raised = {
      ...base,
      attributes: Object.fromEntries(
        Object.entries(base.attributes).map(([k, v]) => [k, v + 3]),
      ) as Player['attributes'],
    }
    for (const skill of COMPOSITES) expect(skill(raised) - skill(base)).toBeCloseTo(3, 10)
  })

  it('use the attributes the design doc names (e.g. Three-Point drives three-point skill)', () => {
    const shooter = makePlayer({ id: 'a', attributes: { threePoint: 20 } })
    expect(offensiveSkill(shooter, 'three')).toBeGreaterThan(offensiveSkill(shooter, 'drive'))
    const handler = makePlayer({ id: 'b', attributes: { ballHandling: 20 } })
    expect(ballSecuritySkill(handler)).toBeGreaterThan(10.5)
  })
})

describe('heightEdge', () => {
  it('is 0 at 200 cm and +1 per 15 cm', () => {
    expect(heightEdge(makePlayer({ id: 'a', heightCm: 200 }))).toBe(0)
    expect(heightEdge(makePlayer({ id: 'a', heightCm: 215 }))).toBeCloseTo(1, 12)
    expect(heightEdge(makePlayer({ id: 'a', heightCm: 185 }))).toBeCloseTo(-1, 12)
  })
})

describe('bestRimProtector', () => {
  it('picks the best rim-protection composite, and the first one on a tie', () => {
    const a = makePlayer({ id: 'a' })
    const b = makePlayer({ id: 'b', attributes: { interiorDefense: 18 } })
    const c = makePlayer({ id: 'c', attributes: { interiorDefense: 18 } })
    expect(bestRimProtector([a, b, c])).toBe(b)
    expect(bestRimProtector([a])).toBe(a)
  })
})
