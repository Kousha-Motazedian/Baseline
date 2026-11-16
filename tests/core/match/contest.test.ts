import { describe, expect, it } from 'vitest'
import type { Contesters } from '../../../src/core/match/contest.ts'
import {
  blendByHelp,
  contestHeight,
  contestSkill,
  findContesters,
  isInsideShot,
  matchupEdge,
} from '../../../src/core/match/contest.ts'
import { defensiveSkill, heightEdge, rimProtectionSkill } from '../../../src/core/match/ratings.ts'
import { DEFENSE_EDGE_WEIGHT, OFFENSE_EDGE_WEIGHT } from '../../../src/core/match/tuning.ts'
import { PLAY_TYPES } from '../../../src/core/match/types.ts'
import { makeFlatTeam, makePlayer, updatePlayer, withAttributes } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'

/** A perimeter defender and a much better, taller rim protector. */
function contesters(): Contesters {
  return {
    defender: makePlayer({ id: 'd', rating: 8, heightCm: 190 }),
    rimProtector: makePlayer({ id: 'r', rating: 16, heightCm: 215 }),
  }
}

describe('isInsideShot / blendByHelp', () => {
  it('treats drives, cuts, post-ups and putbacks as inside shots and jumpers as outside', () => {
    expect(PLAY_TYPES.filter(isInsideShot)).toEqual(['drive', 'cut', 'postUp', 'putback'])
  })

  it('uses only the on-ball value for jumpers and a mix for inside shots', () => {
    expect(blendByHelp('three', 4, 100)).toBe(4)
    expect(blendByHelp('midRange', 4, 100)).toBe(4)
    expect(blendByHelp('drive', 0, 10)).toBeCloseTo(5, 12)
    expect(blendByHelp('postUp', 0, 10)).toBeCloseTo(3, 12)
  })
})

describe('contestSkill / contestHeight', () => {
  it('ignores the rim protector on jumpers', () => {
    const c = contesters()
    expect(contestSkill(c, 'three')).toBe(defensiveSkill(c.defender, 'three'))
    expect(contestHeight(c, 'midRange')).toBe(heightEdge(c.defender))
  })

  it('pulls inside contests toward the rim protector', () => {
    const c = contesters()
    const onBall = defensiveSkill(c.defender, 'drive')
    expect(contestSkill(c, 'drive')).toBeGreaterThan(onBall)
    expect(contestSkill(c, 'drive')).toBeLessThan(rimProtectionSkill(c.rimProtector))
    expect(contestHeight(c, 'cut')).toBeGreaterThan(heightEdge(c.defender))
  })
})

describe('matchupEdge', () => {
  it('is zero at the average level and nearly zero for equal ratings elsewhere', () => {
    // The offense weight (0.70) is a little below the defense weight (0.75) on purpose (balance
    // calibration), so equal ratings above or below average leave a small residual edge.
    expect(matchupEdge(10.5, 10.5)).toBeCloseTo(0, 12)
    const gap = Math.abs(OFFENSE_EDGE_WEIGHT - DEFENSE_EDGE_WEIGHT)
    for (const r of [1, 20, 25]) expect(Math.abs(matchupEdge(r, r))).toBeLessThanOrEqual(gap * 1.6)
  })

  it('a uniform shift of both ratings changes the edge only by the weight gap', () => {
    const gap = Math.abs(OFFENSE_EDGE_WEIGHT - DEFENSE_EDGE_WEIGHT)
    const shift = Math.abs(matchupEdge(17, 12) - matchupEdge(14, 9))
    expect(shift).toBeCloseTo((gap * 3) / 9.5, 12)
  })

  it('is antisymmetric and scales with the edge weight', () => {
    expect(matchupEdge(15, 6)).toBeCloseTo(-matchupEdge(6, 15), 12)
    expect(matchupEdge(20, 10.5)).toBeCloseTo(OFFENSE_EDGE_WEIGHT, 12)
  })
})

describe('findContesters', () => {
  it('pairs lineup slots and finds the best rim protector on the floor', () => {
    const away = updatePlayer(makeFlatTeam('B', 10), 2, (p) =>
      withAttributes(p, { interiorDefense: 19, vertical: 19, shotBlocking: 19 }),
    )
    const game = makeGameState({ home: makeFlatTeam('A', 10), away })
    const shooter = game.home.onCourt[3]
    if (!shooter) throw new Error('lineup missing')
    const c = findContesters(game.home, game.away, shooter)
    expect(c.defender).toBe(game.away.onCourt[3])
    expect(c.rimProtector).toBe(game.away.onCourt[2])
  })
})
