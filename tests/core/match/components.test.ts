import { describe, expect, it } from 'vitest'
import { commitFoul } from '../../../src/core/match/fouls.ts'
import { freeThrowChance } from '../../../src/core/match/freeThrows.ts'
import { periodName, periodStarter, simulateGame } from '../../../src/core/match/game.ts'
import { actionSeconds } from '../../../src/core/match/possession.ts'
import { offensiveReboundChance } from '../../../src/core/match/rebound.ts'
import type { ShotContext } from '../../../src/core/match/shot.ts'
import { makeChance, shootingFoulChance } from '../../../src/core/match/shot.ts'
import {
  clutchEdge,
  contestSituationalEdge,
  formEdge,
  personalEdge,
  roadEdge,
} from '../../../src/core/match/situation.ts'
import type { GameState } from '../../../src/core/match/state.ts'
import { formSpread, isClutch, rollForm, runClock } from '../../../src/core/match/state.ts'
import { stealChance, turnoverChance } from '../../../src/core/match/turnover.ts'
import {
  ACTION_TIMING,
  BASE_FREE_THROW,
  BASE_HANDLER_TURNOVER,
  BASE_MAKE,
  FORM_CLAMP_SDS,
  HOME_SHOOTING_EDGE,
} from '../../../src/core/match/tuning.ts'
import type { PlayType } from '../../../src/core/match/types.ts'
import { PLAY_TYPES } from '../../../src/core/match/types.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import type { LeagueRules } from '../../../src/core/world/rules.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
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
  it('is linear in Free Throw: ≈61.5% at 1, 78.6% at average, ≈95.7% at 20', () => {
    /** Free-throw chance at a given Free Throw rating. */
    const at = (r: number): number =>
      freeThrowChance(makePlayer({ id: 'a', attributes: { freeThrow: r } }))
    expect(at(10.5)).toBeCloseTo(BASE_FREE_THROW, 10)
    expect(at(1)).toBeCloseTo(0.6149, 3)
    expect(at(20)).toBeCloseTo(0.957, 3)
    expect(at(14) - at(12)).toBeCloseTo(at(8) - at(6), 10)
  })

  it('is clamped for out-of-scale ratings', () => {
    /** Free-throw chance at a given Free Throw rating. */
    const at = (r: number): number =>
      freeThrowChance(makePlayer({ id: 'a', attributes: { freeThrow: r } }))
    expect(at(40)).toBe(0.97)
    expect(at(-30)).toBe(0.3)
  })
})

describe('turnoverChance / stealChance', () => {
  it('is the base rate for an even matchup and falls with ball security', () => {
    const avg = makePlayer({ id: 'a' })
    expect(turnoverChance(avg, avg)).toBeCloseTo(BASE_HANDLER_TURNOVER, 10)
    const secure = makePlayer({
      id: 'b',
      attributes: { ballHandling: 20, offensiveIq: 20, passing: 20 },
    })
    const pest = makePlayer({ id: 'c', attributes: { stealing: 20, quickness: 20 } })
    expect(turnoverChance(secure, avg)).toBeLessThan(BASE_HANDLER_TURNOVER)
    expect(turnoverChance(avg, pest)).toBeGreaterThan(BASE_HANDLER_TURNOVER)
  })

  it('treats a positive situational edge as good for the handler', () => {
    const avg = makePlayer({ id: 'a' })
    expect(turnoverChance(avg, avg, 0.2)).toBeLessThan(turnoverChance(avg, avg, 0))
  })

  it('makes better stealers turn more turnovers into steals', () => {
    /** Steal chance at a given Stealing rating. */
    const at = (r: number): number =>
      stealChance(makePlayer({ id: 'a', attributes: { stealing: r } }))
    expect(at(18)).toBeGreaterThan(at(10.5))
    expect(at(1)).toBeGreaterThan(0)
  })
})

describe('makeChance', () => {
  /** Log-odds of a probability. */
  const logit = (p: number): number => Math.log(p / (1 - p))

  it('is the base rate minus only the road-crowd penalty for an even matchup on the road', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10.5),
      away: makeFlatTeam('B', 10.5),
      form: 0,
    })
    // Away team shooting, slot 0 (191 cm) vs slot 0 (191 cm) on a jumper: every skill edge is
    // zero, and the home defender feels no crowd, so only the shooter's road penalty remains.
    const shooter = slot(game.away.onCourt, 0)
    for (const type of ['three', 'midRange'] as const) {
      const p = makeChance(shotContext(game, type, 0, false))
      expect(logit(p) - logit(BASE_MAKE[type])).toBeCloseTo(roadEdge(game.away, shooter), 10)
    }
  })

  it('adds the home edge plus the road defender’s crowd penalty for the home team', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10.5),
      away: makeFlatTeam('B', 10.5),
      form: 0,
    })
    const home = makeChance(shotContext(game, 'three', 0, true))
    const defender = slot(game.away.onCourt, 0)
    const expected = HOME_SHOOTING_EDGE - roadEdge(game.away, defender)
    expect(logit(home) - logit(BASE_MAKE.three)).toBeCloseTo(expected, 10)
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
    const live = offensiveReboundChance(game.home, game.away, 'shot')
    expect(offensiveReboundChance(game.home, game.away, 'freeThrow')).toBeLessThan(live)
    expect(offensiveReboundChance(game.home, game.away, 'block')).toBeLessThan(live)
    const crashers = makeGameState({
      home: patchTeam(makeFlatTeam('A', 10.5), { offensiveRebounding: 18 }),
      away: makeFlatTeam('B', 10.5),
    })
    expect(offensiveReboundChance(crashers.home, crashers.away, 'shot')).toBeGreaterThan(live)
  })
})

describe('actionSeconds', () => {
  it('stays within each action kind’s range and never exceeds the shot clock', () => {
    const rng = createRng(5)
    for (let i = 0; i < 5_000; i++) {
      for (const [kind, { min, spread }] of Object.entries(ACTION_TIMING)) {
        const seconds = actionSeconds(rng, kind as keyof typeof ACTION_TIMING, 24)
        expect(seconds).toBeGreaterThanOrEqual(Math.min(min, 24))
        expect(seconds).toBeLessThanOrEqual(Math.min(min + spread, 24))
      }
      expect(actionSeconds(rng, 'halfCourt', 6)).toBeLessThanOrEqual(6)
    }
  })

  it('keeps putbacks and fast breaks much quicker than half-court sets', () => {
    expect(ACTION_TIMING.putback.min + ACTION_TIMING.putback.spread).toBeLessThan(
      ACTION_TIMING.halfCourt.min,
    )
    expect(ACTION_TIMING.transition.min + ACTION_TIMING.transition.spread / 2).toBeLessThan(
      ACTION_TIMING.halfCourt.min + ACTION_TIMING.halfCourt.spread / 2,
    )
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

  it('FIBA: the alternating arrow gives the tip loser Q2 and Q4, the winner Q3 and OT1', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      rules: FIBA_RULES,
    })
    const starters = [1, 2, 3, 4, 5, 6].map((period) => {
      game.period = period
      return periodStarter(game, game.home)
    })
    expect(starters).toEqual([game.home, game.away, game.home, game.away, game.home, game.away])
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
    /** Sets the game situation and reports whether it counts as clutch time. */
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
    // The home team defends, so no road-crowd penalty muddies the comparison.
    const rimProtector = slot(game.home.onCourt, 4)
    const defender = slot(game.home.onCourt, 0)
    game.home.form.set(rimProtector.id, { offense: 0, defense: 0.2 })
    const contesters = { defender, rimProtector }
    expect(contestSituationalEdge(game, game.home, contesters, 'three')).toBe(0)
    expect(contestSituationalEdge(game, game.home, contesters, 'drive')).toBeCloseTo(0.1, 12)
  })
})

describe('rollForm', () => {
  /** 4,000 form rolls for a player with the given Consistency. */
  function rolls(consistency: number): number[] {
    const rng = createRng(3)
    const p = makePlayer({ id: 'a', consistency })
    return Array.from({ length: 4_000 }, () => rollForm(rng, p))
  }

  it('is normal-shaped around 0 with the documented spread, clamped symmetrically', () => {
    for (const consistency of [1, 10, 20]) {
      const forms = rolls(consistency)
      const sd = formSpread(consistency)
      const mean = forms.reduce((s, f) => s + f, 0) / forms.length
      const measured = Math.sqrt(forms.reduce((s, f) => s + (f - mean) ** 2, 0) / forms.length)
      // SE of the mean ≈ sd / 63; the clamp at 2.5 SD trims the SD by ~3%.
      expect(Math.abs(mean)).toBeLessThan(sd / 15)
      expect(measured / sd).toBeGreaterThan(0.9)
      expect(measured / sd).toBeLessThan(1.05)
      for (const f of forms) expect(Math.abs(f)).toBeLessThanOrEqual(FORM_CLAMP_SDS * sd + 1e-12)
      // Normal, not uniform: about 68% of rolls fall within 1 SD (a uniform roll would give 58%).
      const within = forms.filter((f) => Math.abs(f) <= sd).length / forms.length
      expect(within).toBeGreaterThan(0.64)
      expect(within).toBeLessThan(0.73)
    }
  })

  it('swings far more for inconsistent players (Consistency 1 vs. 20 ≈ 6.7x)', () => {
    expect(formSpread(1) / formSpread(20)).toBeGreaterThan(6)
    expect(formSpread(10.5)).toBeLessThan(formSpread(5))
    expect(formSpread(10.5)).toBeGreaterThan(formSpread(15))
    // Out-of-scale values are clamped to the ends of the scale.
    expect(formSpread(-5)).toBe(formSpread(1))
    expect(formSpread(30)).toBe(formSpread(20))
  })
})

describe('commitFoul (foul-out substitution)', () => {
  it("replaces a fouled-out player in the same slot with the coach's replacement", () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    const big = slot(game.home.onCourt, 4)
    const line = game.home.lines.get(big.id)
    if (!line) throw new Error('missing line')
    line.personalFouls = PRO_RULES.personalFoulLimit - 1
    commitFoul(game, game.home, big, 'Shooting foul')
    expect(line.personalFouls).toBe(PRO_RULES.personalFoulLimit)
    expect(game.home.onCourt).toHaveLength(5)
    expect(game.home.onCourt).not.toContain(big)
    expect(game.home.disqualified.has(big.id)).toBe(true)
    expect(game.playByPlay.some((e) => e.text.includes('fouls out'))).toBe(true)
  })

  it('never brings in a disqualified bench player', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    // Everyone on the bench but one has already fouled out.
    const bench = game.home.team.roster.slice(5)
    for (const p of bench.slice(0, -1)) game.home.disqualified.add(p.id)
    const big = slot(game.home.onCourt, 4)
    const line = game.home.lines.get(big.id)
    if (!line) throw new Error('missing line')
    line.personalFouls = PRO_RULES.personalFoulLimit - 1
    commitFoul(game, game.home, big, 'Shooting foul')
    expect(slot(game.home.onCourt, 4)).toBe(bench[bench.length - 1])
  })

  it('pro, no bench: keeps the player on, and every further foul is a technical free throw', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10, 5), away: makeFlatTeam('B', 10) })
    const guard = slot(game.home.onCourt, 0)
    for (let i = 0; i < PRO_RULES.personalFoulLimit + 2; i++) {
      commitFoul(game, game.home, guard, 'Shooting foul')
    }
    expect(game.home.onCourt).toContain(guard)
    const line = game.home.lines.get(guard.id)
    expect(line?.personalFouls).toBe(PRO_RULES.personalFoulLimit)
    // Two fouls past the limit = two technical free throws (plus one per real technical, if any).
    const awayFta = [...game.away.lines.values()].reduce((s, l) => s + l.freeThrowsAttempted, 0)
    expect(awayFta).toBe(2 + (line?.technicalFouls ?? 0))
    expect(game.home.teamFouls).toBe(PRO_RULES.personalFoulLimit + 2)
  })
})

describe('period starts in simulated games (tester round 3)', { timeout: 60_000 }, () => {
  /** The team that started each period of a game, from its "End of …" lines. */
  function periodStarters(rules: LeagueRules, seed: number): string[] {
    const result = simulateGame({
      home: makeFlatTeam('A', 10.5),
      away: makeFlatTeam('B', 10.5),
      rules,
      seed,
    })
    return result.playByPlay.filter((e) => e.text.startsWith('End of ')).map((e) => e.teamId)
  }

  it('FIBA: periods alternate after the opening tip, overtimes included', () => {
    let overtimes = 0
    for (let seed = 0; seed < 250; seed++) {
      const starters = periodStarters(FIBA_RULES, seed)
      overtimes += starters.length - 4
      starters.forEach((team, i) => {
        if (i > 0) expect(team).not.toBe(starters[i - 1])
      })
    }
    // Enough overtime games to exercise the arrow past regulation.
    expect(overtimes).toBeGreaterThan(3)
  })

  it('pro: Q2 and Q3 go to the tip loser, Q4 to the winner', () => {
    for (let seed = 0; seed < 100; seed++) {
      const [q1, q2, q3, q4] = periodStarters(PRO_RULES, seed)
      expect(q2).not.toBe(q1)
      expect(q3).toBe(q2)
      expect(q4).toBe(q1)
    }
  })

  it('pro periodStarter: every overtime is a fresh jump ball either team can win', () => {
    const winners = new Set<string>()
    for (let seed = 0; seed < 40; seed++) {
      for (const period of [5, 6]) {
        const game = makeGameState({
          home: makeFlatTeam('A', 10),
          away: makeFlatTeam('B', 10),
          seed,
        })
        game.period = period
        winners.add(periodStarter(game, game.home).team.id)
      }
    }
    expect(winners).toEqual(new Set(['A', 'B']))
  })

  it('FIBA periodStarter: the tip loser starts OT2', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      rules: FIBA_RULES,
    })
    game.period = 6
    expect(periodStarter(game, game.away)).toBe(game.home)
  })
})

describe('independent offensive and defensive form (tester round 3)', () => {
  it('each end of the floor uses only its own form roll', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    const player = slot(game.home.onCourt, 0)
    game.home.form.set(player.id, { offense: 0.25, defense: -0.1 })
    expect(formEdge(game.home, player, 'offense')).toBe(0.25)
    expect(formEdge(game.home, player, 'defense')).toBe(-0.1)
    // Home player, not clutch, fresh: the personal edge is just the form at that end.
    expect(personalEdge(game, game.home, player, 'offense')).toBeCloseTo(0.25, 12)
    expect(personalEdge(game, game.home, player, 'defense')).toBeCloseTo(-0.1, 12)
  })

  it('a defender’s offensive form does not change the opponent’s make chance', () => {
    const base = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      form: 0,
    })
    const defender = slot(base.home.onCourt, 0)
    const shooter = slot(base.away.onCourt, 0)
    /** A fresh shot context for the same shooter and defender. */
    const ctx = (): ShotContext => ({
      game: base,
      offense: base.away,
      defense: base.home,
      shooter,
      playType: 'three',
      contesters: { defender, rimProtector: slot(base.home.onCourt, 4), helpFactor: 1 },
    })
    const before = makeChance(ctx())
    base.home.form.set(defender.id, { offense: 0.3, defense: 0 })
    expect(makeChance(ctx())).toBe(before)
    base.home.form.set(defender.id, { offense: 0, defense: 0.3 })
    expect(makeChance(ctx())).toBeLessThan(before)
  })
})
