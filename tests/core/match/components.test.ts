import { describe, expect, it } from 'vitest'
import { recordFoul } from '../../../src/core/match/fouls.ts'
import { freeThrowChance } from '../../../src/core/match/freeThrows.ts'
import { periodName, periodStarter } from '../../../src/core/match/game.ts'
import { actionSeconds } from '../../../src/core/match/possession.ts'
import { offensiveReboundChance } from '../../../src/core/match/rebound.ts'
import type { ShotContext } from '../../../src/core/match/shot.ts'
import { makeChance, shootingFoulChance } from '../../../src/core/match/shot.ts'
import { clutchEdge, contestSituationalEdge } from '../../../src/core/match/situation.ts'
import type { GameState } from '../../../src/core/match/state.ts'
import { isClutch, rollForm, runClock } from '../../../src/core/match/state.ts'
import { stealChance, turnoverChance } from '../../../src/core/match/turnover.ts'
import {
  BASE_FREE_THROW,
  BASE_MAKE,
  BASE_TURNOVER,
  FORM_EDGE_MAX,
  HOME_SHOOTING_EDGE,
} from '../../../src/core/match/tuning.ts'
import type { PlayType } from '../../../src/core/match/types.ts'
import { PLAY_TYPES } from '../../../src/core/match/types.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { PRO_RULES } from '../../../src/core/world/rules.ts'
import { makeFlatTeam, makePlayer, patchTeam } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'

/** The player in a lineup slot (throws if missing, which would be a fixture bug). */
function slot(lineup: readonly Player[], index: number): Player {
  const player = lineup[index]
  if (!player) throw new Error(`no player in slot ${index}`)
  return player
}

/** A shot context for the home team's slot-`index` player shooting a given play type. */
function shotContext(
  game: GameState,
  playType: PlayType,
  index = 0,
  homeShoots = true,
): ShotContext {
  const offense = homeShoots ? game.home : game.away
  const defense = homeShoots ? game.away : game.home
  return {
    game,
    offense,
    defense,
    shooter: slot(offense.onCourt, index),
    contesters: { defender: slot(defense.onCourt, index), rimProtector: slot(defense.onCourt, 4) },
    playType,
  }
}

describe('freeThrowChance', () => {
  it('is linear in Free Throw: ≈61% at 1, 78% at average, ≈95% at 20', () => {
    const at = (r: number): number =>
      freeThrowChance(makePlayer({ id: 'a', attributes: { freeThrow: r } }))
    expect(at(10.5)).toBeCloseTo(BASE_FREE_THROW, 10)
    expect(at(1)).toBeCloseTo(0.609, 3)
    expect(at(20)).toBeCloseTo(0.951, 3)
    expect(at(14) - at(12)).toBeCloseTo(at(8) - at(6), 10)
  })

  it('is clamped for out-of-scale ratings', () => {
    const at = (r: number): number =>
      freeThrowChance(makePlayer({ id: 'a', attributes: { freeThrow: r } }))
    expect(at(40)).toBe(0.97)
    expect(at(-30)).toBe(0.3)
  })
})

describe('turnoverChance / stealChance', () => {
  it('is the base rate for an even matchup and falls with ball security', () => {
    const avg = makePlayer({ id: 'a' })
    expect(turnoverChance(avg, avg)).toBeCloseTo(BASE_TURNOVER, 10)
    const secure = makePlayer({
      id: 'b',
      attributes: { ballHandling: 20, offensiveIq: 20, passing: 20 },
    })
    const pest = makePlayer({ id: 'c', attributes: { stealing: 20, quickness: 20 } })
    expect(turnoverChance(secure, avg)).toBeLessThan(BASE_TURNOVER)
    expect(turnoverChance(avg, pest)).toBeGreaterThan(BASE_TURNOVER)
  })

  it('treats a positive situational edge as good for the handler', () => {
    const avg = makePlayer({ id: 'a' })
    expect(turnoverChance(avg, avg, 0.2)).toBeLessThan(turnoverChance(avg, avg, 0))
  })

  it('makes better stealers turn more turnovers into steals', () => {
    const at = (r: number): number =>
      stealChance(makePlayer({ id: 'a', attributes: { stealing: r } }))
    expect(at(18)).toBeGreaterThan(at(10.5))
    expect(at(1)).toBeGreaterThan(0)
  })
})

describe('makeChance', () => {
  it('equals the base rate for an even, average matchup on the road with no form', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10.5),
      away: makeFlatTeam('B', 10.5),
      form: 0,
    })
    // Away team shooting, slot 0 (191 cm) vs slot 0 (191 cm) on a jumper: every edge is zero.
    for (const type of ['three', 'midRange'] as const) {
      expect(makeChance(shotContext(game, type, 0, false))).toBeCloseTo(BASE_MAKE[type], 10)
    }
  })

  it('adds exactly the home edge for the home team', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10.5),
      away: makeFlatTeam('B', 10.5),
      form: 0,
    })
    const home = makeChance(shotContext(game, 'three', 0, true))
    const logit = (p: number): number => Math.log(p / (1 - p))
    expect(logit(home) - logit(BASE_MAKE.three)).toBeCloseTo(HOME_SHOOTING_EDGE, 10)
  })

  it('stays strictly between 0 and 1 for the most extreme matchups', () => {
    for (const [o, d] of [
      [1, 20],
      [20, 1],
      [1, 1],
      [20, 20],
    ] as const) {
      const game = makeGameState({ home: makeFlatTeam('A', o), away: makeFlatTeam('B', d) })
      for (const type of PLAY_TYPES) {
        for (let i = 0; i < 5; i++) {
          const p = makeChance(shotContext(game, type, i))
          expect(p).toBeGreaterThan(0.01)
          expect(p).toBeLessThan(0.99)
          const f = shootingFoulChance(shotContext(game, type, i))
          expect(f).toBeGreaterThan(0)
          expect(f).toBeLessThan(1)
        }
      }
    }
  })

  it('rises with the shooter skill and falls with the defender skill', () => {
    const even = makeGameState({
      home: makeFlatTeam('A', 10.5),
      away: makeFlatTeam('B', 10.5),
      form: 0,
    })
    const strongO = makeGameState({
      home: makeFlatTeam('A', 14),
      away: makeFlatTeam('B', 10.5),
      form: 0,
    })
    const strongD = makeGameState({
      home: makeFlatTeam('A', 10.5),
      away: makeFlatTeam('B', 14),
      form: 0,
    })
    for (const type of PLAY_TYPES) {
      const base = makeChance(shotContext(even, type))
      expect(makeChance(shotContext(strongO, type))).toBeGreaterThan(base)
      expect(makeChance(shotContext(strongD, type))).toBeLessThan(base)
    }
  })

  it('gives a taller finisher an edge near the basket but not on jumpers', () => {
    const tallShooter = makeFlatTeam('A', 10.5)
    tallShooter.roster[0] = makePlayer({ id: 'tall', heightCm: 215 })
    const game = makeGameState({
      home: makeFlatTeam('C', 10.5),
      away: makeFlatTeam('B', 10.5),
      form: 0,
    })
    const tall = makeGameState({ home: tallShooter, away: makeFlatTeam('B', 10.5), form: 0 })
    expect(makeChance(shotContext(tall, 'drive'))).toBeGreaterThan(
      makeChance(shotContext(game, 'drive')),
    )
    expect(makeChance(shotContext(tall, 'three'))).toBeCloseTo(
      makeChance(shotContext(game, 'three')),
      12,
    )
  })
})

describe('shootingFoulChance', () => {
  it('rises with shooter Aggression and falls with defender Discipline', () => {
    const base = makeGameState({ home: makeFlatTeam('A', 10.5), away: makeFlatTeam('B', 10.5) })
    const aggressive = makeGameState({
      home: patchTeam(makeFlatTeam('A', 10.5), { aggression: 18 }),
      away: makeFlatTeam('B', 10.5),
    })
    const disciplined = makeGameState({
      home: makeFlatTeam('A', 10.5),
      away: patchTeam(makeFlatTeam('B', 10.5), { discipline: 18 }),
    })
    const p = shootingFoulChance(shotContext(base, 'drive'))
    expect(shootingFoulChance(shotContext(aggressive, 'drive'))).toBeGreaterThan(p)
    expect(shootingFoulChance(shotContext(disciplined, 'drive'))).toBeLessThan(p)
  })
})

describe('offensiveReboundChance', () => {
  it('is lower after a free throw and rises with offensive rebounding and size', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10.5), away: makeFlatTeam('B', 10.5) })
    const live = offensiveReboundChance(game.home, game.away, false)
    expect(offensiveReboundChance(game.home, game.away, true)).toBeLessThan(live)
    const crashers = makeGameState({
      home: patchTeam(makeFlatTeam('A', 10.5), { offensiveRebounding: 18 }),
      away: makeFlatTeam('B', 10.5),
    })
    expect(offensiveReboundChance(crashers.home, crashers.away, false)).toBeGreaterThan(live)
  })
})

describe('actionSeconds', () => {
  it('stays within the documented ranges and never exceeds the shot clock', () => {
    const rng = createRng(5)
    for (let i = 0; i < 5_000; i++) {
      const first = actionSeconds(rng, false, 24)
      expect(first).toBeGreaterThanOrEqual(4)
      expect(first).toBeLessThanOrEqual(24)
      const second = actionSeconds(rng, true, 14)
      expect(second).toBeGreaterThanOrEqual(1)
      expect(second).toBeLessThanOrEqual(11)
      expect(actionSeconds(rng, false, 6)).toBeLessThanOrEqual(6)
    }
  })
})

describe('runClock', () => {
  it('never runs the clock below zero and credits only the seconds actually used', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      clock: 5,
    })
    expect(runClock(game, 12)).toBe(5)
    expect(game.clock).toBe(0)
    const line = game.home.lines.get(slot(game.home.onCourt, 0).id)
    expect(line?.secondsPlayed).toBe(5)
  })
})

describe('periodStarter / periodName', () => {
  it('gives the tip winner Q1 and Q4 and the other team Q2 and Q3', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    const starters = [1, 2, 3, 4].map((period) => {
      game.period = period
      return periodStarter(game, game.home)
    })
    expect(starters).toEqual([game.home, game.away, game.away, game.home])
  })

  it('names regulation and overtime periods', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    const names = [1, 4, 5, 6].map((period) => {
      game.period = period
      return periodName(game)
    })
    expect(names).toEqual(['Q1', 'Q4', 'OT', 'OT2'])
  })
})

describe('clutch time', () => {
  it('only applies late in the last regulation period or overtime, in a close game', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    const check = (period: number, clock: number, margin: number): boolean => {
      game.period = period
      game.clock = clock
      game.home.points = 100 + margin
      game.away.points = 100
      return isClutch(game, 120, 5)
    }
    expect(check(4, 100, 3)).toBe(true)
    expect(check(5, 30, -5)).toBe(true)
    expect(check(3, 100, 0)).toBe(false)
    expect(check(4, 200, 0)).toBe(false)
    expect(check(4, 100, 6)).toBe(false)
  })

  it('rewards Composure at both ends only in clutch time', () => {
    const calm = makePlayer({ id: 'calm', attributes: { composure: 20 } })
    const game = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      period: 1,
    })
    expect(clutchEdge(game, calm)).toBe(0)
    game.period = 4
    game.clock = 60
    expect(clutchEdge(game, calm)).toBeGreaterThan(0)
  })

  it('weights the help defender’s situational edge by their share of the contest', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      form: 0,
    })
    const rimProtector = slot(game.away.onCourt, 4)
    const defender = slot(game.away.onCourt, 0)
    game.away.form.set(rimProtector.id, 0.2)
    const contesters = { defender, rimProtector }
    expect(contestSituationalEdge(game, game.away, contesters, 'three')).toBe(0)
    expect(contestSituationalEdge(game, game.away, contesters, 'drive')).toBeCloseTo(0.1, 12)
  })
})

describe('rollForm', () => {
  it('stays within ±FORM_EDGE_MAX and swings less for consistent players', () => {
    const rng = createRng(3)
    const spread = (consistency: number): number => {
      const p = makePlayer({ id: 'a', consistency })
      let max = 0
      for (let i = 0; i < 2_000; i++) {
        const form = rollForm(rng, p)
        expect(Math.abs(form)).toBeLessThanOrEqual(FORM_EDGE_MAX)
        max = Math.max(max, Math.abs(form))
      }
      return max
    }
    expect(spread(20)).toBeLessThan(FORM_EDGE_MAX / 10)
    expect(spread(1)).toBeGreaterThan(FORM_EDGE_MAX * 0.95)
  })
})

describe('recordFoul (foul-out substitution)', () => {
  /** A 10-man flat team with chosen heights, so the closest-height rule is easy to check. */
  function teamWithHeights(heights: readonly number[]) {
    const team = makeFlatTeam('A', 10)
    team.roster = team.roster.map((p, i) => ({
      ...p,
      measurables: { ...p.measurables, heightCm: heights[i] ?? 200 },
    }))
    return team
  }

  it('replaces a fouled-out player in the same slot with the closest-height bench player', () => {
    const home = teamWithHeights([190, 192, 200, 202, 212, 185, 193, 205, 208, 220])
    const game = makeGameState({ home, away: makeFlatTeam('B', 10) })
    const big = slot(game.home.onCourt, 4)
    const line = game.home.lines.get(big.id)
    if (!line) throw new Error('missing line')
    line.personalFouls = PRO_RULES.personalFoulLimit - 1
    recordFoul(game, game.home, big)
    expect(line.personalFouls).toBe(PRO_RULES.personalFoulLimit)
    expect(slot(game.home.onCourt, 4).measurables.heightCm).toBe(208)
    expect(game.home.onCourt).not.toContain(big)
    expect(game.playByPlay.at(-1)?.text).toContain('fouls out')
  })

  it('skips bench players who have already fouled out', () => {
    const home = teamWithHeights([190, 192, 200, 202, 212, 185, 193, 205, 208, 220])
    const game = makeGameState({ home, away: makeFlatTeam('B', 10) })
    const benchBig = slot(home.roster, 8)
    const benchLine = game.home.lines.get(benchBig.id)
    if (!benchLine) throw new Error('missing line')
    benchLine.personalFouls = PRO_RULES.personalFoulLimit
    const big = slot(game.home.onCourt, 4)
    const line = game.home.lines.get(big.id)
    if (!line) throw new Error('missing line')
    line.personalFouls = PRO_RULES.personalFoulLimit - 1
    recordFoul(game, game.home, big)
    // 208 is out, so 205 and 220 are next; 205 is 7 cm away vs 8 cm.
    expect(slot(game.home.onCourt, 4).measurables.heightCm).toBe(205)
  })

  it('keeps the player on the floor when nobody is left on the bench', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10, 5), away: makeFlatTeam('B', 10) })
    const guard = slot(game.home.onCourt, 0)
    for (let i = 0; i < PRO_RULES.personalFoulLimit + 2; i++) recordFoul(game, game.home, guard)
    expect(game.home.onCourt).toContain(guard)
    expect(game.home.lines.get(guard.id)?.personalFouls).toBe(PRO_RULES.personalFoulLimit + 2)
  })
})
