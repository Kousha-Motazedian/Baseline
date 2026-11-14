/**
 * STOPGAP foul-trouble benching: per-period thresholds, who sits and who replaces him, when the
 * regular returns, foul-trouble caution, and how it interacts with disqualifications.
 */
import { describe, expect, it } from 'vitest'
import {
  commitFoul,
  nonShootingFoulChance,
  offensiveFoulChance,
} from '../../../src/core/match/fouls.ts'
import {
  foulCautionEdge,
  foulTroubleThreshold,
  sitsForFouls,
  updateFoulTroubleBench,
} from '../../../src/core/match/foulTrouble.ts'
import { disqualify } from '../../../src/core/match/lineup.ts'
import type { GameState, TeamState } from '../../../src/core/match/state.ts'
import { lineOf } from '../../../src/core/match/state.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { makeFlatTeam } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'
import { playSeries, SLOW_TEST_TIMEOUT_MS } from '../../helpers/simulation.ts'

/** The player in a lineup slot (throws if missing, which would be a fixture bug). */
function slot(lineup: readonly Player[], index: number): Player {
  const player = lineup[index]
  if (!player) throw new Error(`no player in slot ${index}`)
  return player
}

/** A flat game at a given period and clock. */
function gameAt(period: number, clock: number, rules = PRO_RULES): GameState {
  return makeGameState({
    home: makeFlatTeam('A', 10),
    away: makeFlatTeam('B', 10),
    rules,
    period,
    clock,
  })
}

/** Gives a player `fouls` personal fouls directly (no foul events). */
function setFouls(team: TeamState, player: Player, fouls: number): void {
  lineOf(team, player).personalFouls = fouls
}

describe('foul-trouble thresholds', () => {
  it('pro: 2 in Q1, 3 in Q2, 4 in Q3, 5 in Q4 until the last 5:00, then nobody sits', () => {
    expect(foulTroubleThreshold(gameAt(1, 600))).toBe(2)
    expect(foulTroubleThreshold(gameAt(2, 600))).toBe(3)
    expect(foulTroubleThreshold(gameAt(3, 600))).toBe(4)
    expect(foulTroubleThreshold(gameAt(4, 400))).toBe(5)
    expect(foulTroubleThreshold(gameAt(4, 300))).toBe(Infinity)
    expect(foulTroubleThreshold(gameAt(5, 200))).toBe(Infinity)
  })

  it('FIBA (5-foul limit): never sits a player for fewer than 2 fouls', () => {
    expect(foulTroubleThreshold(gameAt(1, 500, FIBA_RULES))).toBe(2)
    expect(foulTroubleThreshold(gameAt(2, 500, FIBA_RULES))).toBe(2)
    expect(foulTroubleThreshold(gameAt(3, 500, FIBA_RULES))).toBe(3)
    expect(foulTroubleThreshold(gameAt(4, 400, FIBA_RULES))).toBe(4)
  })
})

describe('benching and returning', () => {
  it('sits a starter at 2 fouls in Q1 for the closest-height reserve, and logs it', () => {
    const game = gameAt(1, 500)
    const big = slot(game.home.onCourt, 4)
    setFouls(game.home, big, 1)
    commitFoul(game, game.home, big, 'Holding foul')
    expect(game.home.onCourt).not.toContain(big)
    const sub = slot(game.home.onCourt, 4)
    expect(sub.measurables.heightCm).toBe(big.measurables.heightCm)
    expect(game.home.regulars[4]).toBe(big)
    expect(game.playByPlay.at(-1)?.text).toMatch(/sits with 2 fouls; \S+ checks in$/)
  })

  it('brings the regular back once the next period raises the threshold', () => {
    const game = gameAt(1, 500)
    const guard = slot(game.home.onCourt, 0)
    setFouls(game.home, guard, 2)
    updateFoulTroubleBench(game, game.home)
    expect(game.home.onCourt).not.toContain(guard)
    game.period = 2
    updateFoulTroubleBench(game, game.home)
    expect(slot(game.home.onCourt, 0)).toBe(guard)
    expect(game.playByPlay.at(-1)?.text).toMatch(/checks in for/)
  })

  it('a player on 5 fouls sits in Q4 until the last 5:00, then returns', () => {
    const game = gameAt(4, 400)
    const wing = slot(game.home.onCourt, 2)
    setFouls(game.home, wing, 5)
    updateFoulTroubleBench(game, game.home)
    expect(game.home.onCourt).not.toContain(wing)
    game.clock = 299
    updateFoulTroubleBench(game, game.home)
    expect(slot(game.home.onCourt, 2)).toBe(wing)
  })

  it('never sits anyone without a bench player to replace him', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10, 5),
      away: makeFlatTeam('B', 10),
      period: 1,
      clock: 500,
    })
    const player = slot(game.home.onCourt, 1)
    setFouls(game.home, player, 3)
    updateFoulTroubleBench(game, game.home)
    expect(game.home.onCourt).toContain(player)
  })

  it('does not use a reserve who is in foul trouble himself', () => {
    const game = gameAt(1, 500)
    const starter = slot(game.home.onCourt, 4)
    // Bench bigs (slots 8 and 9 in the fixture, 210 cm) are both in foul trouble.
    for (const id of ['A9', 'A10']) {
      const reserve = game.home.team.roster.find((p) => p.id === id)
      if (reserve) setFouls(game.home, reserve, 2)
    }
    setFouls(game.home, starter, 2)
    updateFoulTroubleBench(game, game.home)
    const sub = slot(game.home.onCourt, 4)
    expect(sub).not.toBe(starter)
    expect(sitsForFouls(game, game.home, sub)).toBe(false)
  })

  it('a disqualified regular is replaced and the replacement becomes the regular', () => {
    const game = gameAt(1, 500)
    const starter = slot(game.home.onCourt, 3)
    disqualify(game, game.home, starter, 'ejected')
    const replacement = slot(game.home.onCourt, 3)
    expect(game.home.regulars[3]).toBe(replacement)
  })

  it('a sub disqualified while the regular sits is replaced by another free reserve', () => {
    const game = gameAt(1, 500)
    const regular = slot(game.home.onCourt, 3)
    setFouls(game.home, regular, 2)
    updateFoulTroubleBench(game, game.home)
    const sub = slot(game.home.onCourt, 3)
    disqualify(game, game.home, sub, 'ejected', (p) => sitsForFouls(game, game.home, p))
    expect(game.home.onCourt).not.toContain(sub)
    expect(game.home.onCourt).not.toContain(regular)
    expect(game.home.regulars[3]).toBe(regular)
  })
})

describe('foul-trouble caution', () => {
  it('only a player one foul from disqualification plays it safe', () => {
    const game = gameAt(4, 200)
    const player = slot(game.home.onCourt, 0)
    setFouls(game.home, player, 4)
    expect(foulCautionEdge(game, game.home, player)).toBe(0)
    setFouls(game.home, player, 5)
    expect(foulCautionEdge(game, game.home, player)).toBeLessThan(0)
  })
})

describe('in simulated games', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('benches players in foul trouble and keeps foul-outs rare', () => {
    const results = playSeries(makeFlatTeam('A', 10.5), makeFlatTeam('B', 10.5), 60)
    let benchings = 0
    let foulOuts = 0
    for (const r of results) {
      benchings += r.playByPlay.filter((e) => / sits with \d fouls;/.test(e.text)).length
      foulOuts += r.playByPlay.filter((e) => /fouls out/.test(e.text)).length
    }
    expect(benchings / results.length).toBeGreaterThan(1)
    expect(foulOuts / results.length).toBeLessThan(0.8)
  })
})

describe('foul-trouble edges (tester round 3)', () => {
  it('pro Q4: sits at 5 fouls with 5:00.1 left, released at exactly 5:00', () => {
    expect(foulTroubleThreshold(gameAt(4, 300.1))).toBe(5)
    expect(foulTroubleThreshold(gameAt(4, 300))).toBe(Infinity)
  })

  it('FIBA Q4: a player on 4 fouls sits before the last 5:00 and plays it safe', () => {
    const game = gameAt(4, 400, FIBA_RULES)
    const player = slot(game.home.onCourt, 1)
    setFouls(game.home, player, 4)
    expect(sitsForFouls(game, game.home, player)).toBe(true)
    expect(foulCautionEdge(game, game.home, player)).toBeLessThan(0)
    setFouls(game.home, player, 3)
    expect(sitsForFouls(game, game.home, player)).toBe(false)
    expect(foulCautionEdge(game, game.home, player)).toBe(0)
  })

  it('nobody sits in overtime, and a disqualified player is never "resting" or cautious', () => {
    const overtime = gameAt(5, 200)
    const player = slot(overtime.home.onCourt, 0)
    setFouls(overtime.home, player, 5)
    expect(sitsForFouls(overtime, overtime.home, player)).toBe(false)
    const game = gameAt(1, 500)
    const out = slot(game.home.onCourt, 2)
    setFouls(game.home, out, 6)
    game.home.disqualified.add(out.id)
    expect(sitsForFouls(game, game.home, out)).toBe(false)
    expect(foulCautionEdge(game, game.home, out)).toBe(0)
  })

  it('caution cuts foul chances to about a sixth at small base rates', () => {
    const handler = makeFlatTeam('X', 10.5).roster[0]
    const defender = makeFlatTeam('Y', 10.5).roster[0]
    if (!handler || !defender) throw new Error('missing player')
    const normal = nonShootingFoulChance(0.086, handler, defender)
    const cautious = nonShootingFoulChance(0.086, handler, defender, -2)
    expect(cautious / normal).toBeGreaterThan(0.14)
    expect(cautious / normal).toBeLessThan(0.2)
    expect(offensiveFoulChance(0.03, handler, defender, -2)).toBeLessThan(
      offensiveFoulChance(0.03, handler, defender) / 5,
    )
  })

  it('a benched regular stays out through the period and returns in the next one', () => {
    const game = gameAt(2, 600)
    const regular = slot(game.home.onCourt, 0)
    setFouls(game.home, regular, 3)
    updateFoulTroubleBench(game, game.home)
    const sub = slot(game.home.onCourt, 0)
    expect(sub).not.toBe(regular)
    // Later in the same period: still sitting, the same sub keeps the slot.
    game.clock = 30
    updateFoulTroubleBench(game, game.home)
    expect(slot(game.home.onCourt, 0)).toBe(sub)
    // Q3: the threshold is 4, so he returns.
    game.period = 3
    game.clock = 720
    updateFoulTroubleBench(game, game.home)
    expect(slot(game.home.onCourt, 0)).toBe(regular)
    expect(game.home.regulars[0]).toBe(regular)
  })

  it('a sub who gets into foul trouble himself is swapped for another free reserve', () => {
    const game = gameAt(1, 600)
    const regular = slot(game.home.onCourt, 0)
    setFouls(game.home, regular, 2)
    updateFoulTroubleBench(game, game.home)
    const firstSub = slot(game.home.onCourt, 0)
    setFouls(game.home, firstSub, 2)
    updateFoulTroubleBench(game, game.home)
    const secondSub = slot(game.home.onCourt, 0)
    expect(secondSub).not.toBe(firstSub)
    expect(secondSub).not.toBe(regular)
    expect(game.home.regulars).not.toContain(secondSub)
  })

  it('another slot’s resting regular is never used as a foul-trouble sub', () => {
    // 6-man roster: one reserve. Two starters in foul trouble: only one can sit.
    const game = makeGameState({
      home: makeFlatTeam('A', 10, 6),
      away: makeFlatTeam('B', 10),
      period: 1,
      clock: 500,
    })
    const a = slot(game.home.onCourt, 0)
    const b = slot(game.home.onCourt, 1)
    setFouls(game.home, a, 2)
    setFouls(game.home, b, 2)
    updateFoulTroubleBench(game, game.home)
    const onFloor = game.home.onCourt.filter((p) => p === a || p === b)
    expect(onFloor).toHaveLength(1)
    expect(new Set(game.home.onCourt).size).toBe(5)
  })
})
