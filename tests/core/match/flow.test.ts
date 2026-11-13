/**
 * Possession flow: ball path (handler → shooter), turnover and assist attribution, putbacks,
 * fast breaks, late-game score effects, composure, and the play-by-play convention.
 */
import { describe, expect, it } from 'vitest'
import { fastBreakChance, transitionShotEdge } from '../../../src/core/match/fastBreak.ts'
import { freeThrowChance } from '../../../src/core/match/freeThrows.ts'
import { pickHandler } from '../../../src/core/match/handler.ts'
import { rushPenalty } from '../../../src/core/match/possession.ts'
import { putbackChance } from '../../../src/core/match/rebound.ts'
import {
  endOfPeriodSeconds,
  holdsForLastShot,
  milkShare,
  scoreAdjustedSeconds,
  threePointHuntFactor,
  wantsIntentionalFoul,
} from '../../../src/core/match/scoreEffects.ts'
import { roadEdge } from '../../../src/core/match/situation.ts'
import { TYING_TWO_THREE_FACTOR } from '../../../src/core/match/tuning.ts'
import { tryHandlerTurnover } from '../../../src/core/match/turnover.ts'
import type { MatchResult } from '../../../src/core/match/types.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { generatedPair, makeFlatTeam, makePlayer, patchTeam } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'
import { playSeries, seriesTotal, sides, SLOW_TEST_TIMEOUT_MS } from '../../helpers/simulation.ts'

/** The player in a lineup slot (throws if missing, which would be a fixture bug). */
function slot(lineup: readonly Player[], index: number): Player {
  const player = lineup[index]
  if (!player) throw new Error(`no player in slot ${index}`)
  return player
}

/** 80 games between two generated teams, shared by the game-level checks below. */
const [HOME, AWAY] = generatedPair(61)
const GAMES: MatchResult[] = playSeries(HOME, AWAY, 80)

/** Every play-by-play line across the shared games. */
const LINES = GAMES.flatMap((r) => r.playByPlay)

describe('ball handler', () => {
  it('goes mostly to good handlers (guards)', () => {
    const guard = makePlayer({ id: 'g', attributes: { ballHandling: 16, passing: 15 } })
    const big = makePlayer({ id: 'b', attributes: { ballHandling: 6, passing: 7 } })
    const rng = createRng(4)
    let guardCount = 0
    for (let i = 0; i < 2_000; i++) if (pickHandler(rng, [guard, big]) === guard) guardCount++
    expect(guardCount / 2_000).toBeGreaterThan(0.8)
  })
})

describe('turnover attribution', () => {
  it('charges a bad pass to the handler and the steal to an involved defender', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    const handler = slot(game.home.onCourt, 0)
    const receiver = slot(game.home.onCourt, 4)
    const handlerDefender = slot(game.away.onCourt, 0)
    const receiverDefender = slot(game.away.onCourt, 4)
    let turnovers = 0
    for (let i = 0; i < 200; i++) {
      const outcome = tryHandlerTurnover({
        game,
        offense: game.home,
        defense: game.away,
        handler,
        handlerDefender,
        receiver,
        receiverDefender,
        base: 0.5,
      })
      if (outcome) turnovers++
    }
    expect(game.home.lines.get(handler.id)?.turnovers).toBe(turnovers)
    expect(game.home.lines.get(receiver.id)?.turnovers).toBe(0)
    // Both the on-ball defender and the passing-lane defender pick off passes.
    expect(game.away.lines.get(handlerDefender.id)?.steals).toBeGreaterThan(0)
    expect(game.away.lines.get(receiverDefender.id)?.steals).toBeGreaterThan(0)
    const otherSteals = [1, 2, 3].map(
      (i) => game.away.lines.get(slot(game.away.onCourt, i).id)?.steals,
    )
    expect(otherSteals).toEqual([0, 0, 0])
  })
})

describe('assists', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('never credits the shooter, and never assists putbacks', () => {
    // Generated rosters can repeat a last name, which would make "Vance (assist Vance)" ambiguous.
    const names = [...HOME.roster, ...AWAY.roster].map((p) => p.lastName)
    const unique = (name: string): boolean => names.filter((n) => n === name).length === 1
    for (const line of LINES) {
      const match = /^(\S+) makes .*\(assist (\S+)\)$/.exec(line.text)
      if (match?.[1] && unique(match[1])) expect(match[1]).not.toBe(match[2])
      if (/makes putback/.test(line.text)) expect(line.text).not.toContain('assist')
    }
  })

  it('come mostly from the good passers who handle the ball', () => {
    const guards = [0, 1].map((i) => slot(HOME.roster, i).id)
    const assists = (id: string): number =>
      GAMES.reduce(
        (s, r) => s + (sides(r, 'home')[0].players.find((l) => l.playerId === id)?.assists ?? 0),
        0,
      )
    const guardShare =
      guards.reduce((s, id) => s + assists(id), 0) / seriesTotal(GAMES, 'home', 'assists')
    // Two of five starters, but well over 40% of the assists.
    expect(guardShare).toBeGreaterThan(0.5)
  })
})

describe('putbacks', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('are more likely for big finishers than for small guards', () => {
    const big = makePlayer({ id: 'b', heightCm: 212, attributes: { finishing: 15, vertical: 14 } })
    const guard = makePlayer({ id: 'g', heightCm: 188, attributes: { finishing: 9, vertical: 9 } })
    expect(putbackChance(big)).toBeGreaterThan(putbackChance(guard))
  })

  it('are taken by the offensive rebounder himself', () => {
    let checked = 0
    for (const r of GAMES) {
      r.playByPlay.forEach((entry, i) => {
        const rebounder = /^(\S+) offensive rebound$/.exec(entry.text)?.[1]
        const next = r.playByPlay[i + 1]
        if (!rebounder || !next || !/putback/.test(next.text)) return
        expect(next.text.startsWith(`${rebounder} `)).toBe(true)
        checked++
      })
    }
    expect(checked).toBeGreaterThan(50)
  })
})

describe('fast breaks', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('are more likely for the faster team', () => {
    const game = makeGameState({
      home: patchTeam(makeFlatTeam('A', 10.5), { speed: 17 }),
      away: makeFlatTeam('B', 10.5),
    })
    const fast = fastBreakChance(0.5, game.home, game.away)
    expect(fast).toBeGreaterThan(0.5)
    expect(fastBreakChance(0.5, game.away, game.home)).toBeLessThan(0.5)
  })

  it('give the offense a bigger edge when it outnumbers the defense', () => {
    expect(transitionShotEdge(undefined)).toBe(0)
    expect(transitionShotEdge({ outnumbered: true })).toBeGreaterThan(
      transitionShotEdge({ outnumbered: false }),
    )
  })

  it('produce fast-break points, all of them within the team total', () => {
    const fastBreakPoints = GAMES.reduce((s, r) => s + r.home.fastBreakPoints, 0) / GAMES.length
    expect(fastBreakPoints).toBeGreaterThan(6)
    expect(fastBreakPoints).toBeLessThan(25)
    expect(LINES.some((e) => /on the fast break/.test(e.text))).toBe(true)
  })

  it('a much faster team scores more fast-break points', () => {
    const fast = patchTeam(HOME, { speed: 18 })
    const slow = patchTeam(HOME, { speed: 4 })
    const fb = (rs: MatchResult[]): number =>
      rs.reduce((s, r) => s + (r.home.teamId === 'home' ? r.home : r.away).fastBreakPoints, 0)
    expect(fb(playSeries(fast, AWAY, 40))).toBeGreaterThan(1.3 * fb(playSeries(slow, AWAY, 40)))
  })
})

describe('late-game score effects', () => {
  /** A game in Q4 with the home team leading by `lead` and `clock` seconds left. */
  function lateGame(lead: number, clock: number) {
    const game = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      period: 4,
      clock,
    })
    game.home.points = 100 + lead
    game.away.points = 100
    return game
  }

  it('the leading team runs clock late, more for bigger leads', () => {
    expect(milkShare(lateGame(6, 400), lateGame(6, 400).home)).toBe(0)
    const small = lateGame(1, 100)
    const big = lateGame(8, 100)
    expect(milkShare(small, small.home)).toBeGreaterThan(0)
    expect(milkShare(big, big.home)).toBeGreaterThan(milkShare(small, small.home))
    expect(milkShare(big, big.away)).toBe(0)
    expect(scoreAdjustedSeconds(big, big.home, 10, 24)).toBeGreaterThan(18)
    // In the last ~1:30 the trailing team hurries instead.
    const hurry = lateGame(8, 80)
    expect(scoreAdjustedSeconds(hurry, hurry.away, 10, 24)).toBeLessThan(10)
  })

  it('a tied team holds for the last shot', () => {
    const game = lateGame(0, 20)
    expect(holdsForLastShot(game, game.home, 24)).toBe(true)
    expect(endOfPeriodSeconds(game, game.home, 6, 24, 5)).toBeCloseTo(18, 10)
    expect(holdsForLastShot(lateGame(0, 40), game.home, 24)).toBe(false)
  })

  it('the trailing team fouls on purpose when down 4+ in the last 30 s, up to a shrinking cap', () => {
    expect(wantsIntentionalFoul(lateGame(6, 25), lateGame(6, 25).away)).toBe(true)
    // Cap at 0:25 is 3 + 25 / 6 ≈ 7.2 and at 0:06 it's 4; at 0:50 it's too early to foul.
    const cases: [number, number][] = [
      [8, 25],
      [6, 50],
      [5, 6],
    ]
    for (const [lead, clock] of cases) {
      const game = lateGame(lead, clock)
      expect(wantsIntentionalFoul(game, game.away, clock)).toBe(false)
    }
    const leading = lateGame(6, 25)
    expect(wantsIntentionalFoul(leading, leading.home)).toBe(false)
  })

  it('the trailing team hunts threes when down 3+, more urgently as time runs out', () => {
    const early = lateGame(5, 110)
    const late = lateGame(5, 10)
    expect(threePointHuntFactor(early, early.away)).toBeGreaterThan(1)
    expect(threePointHuntFactor(late, late.away)).toBeGreaterThan(
      threePointHuntFactor(early, early.away),
    )
    expect(threePointHuntFactor(late, late.home)).toBe(1)
    // Down 2 in the final 30 s the tying two is preferred; earlier, no change.
    const downTwo = lateGame(2, 10)
    expect(threePointHuntFactor(downTwo, downTwo.away)).toBe(TYING_TWO_THREE_FACTOR)
    const downTwoEarly = lateGame(2, 60)
    expect(threePointHuntFactor(downTwoEarly, downTwoEarly.away)).toBe(1)
  })

  it('rushes a shot the period clock cuts short', () => {
    expect(rushPenalty(20, 10)).toBe(0)
    expect(rushPenalty(1, 10)).toBeGreaterThan(rushPenalty(5, 10))
  })
})

describe('composure', () => {
  it('moves free throws only in clutch time, up for calm players and down for nervous ones', () => {
    const calm = makePlayer({ id: 'c', attributes: { composure: 20 } })
    const nervous = makePlayer({ id: 'n', attributes: { composure: 1 } })
    expect(freeThrowChance(calm)).toBe(freeThrowChance(nervous))
    expect(freeThrowChance(calm, true)).toBeGreaterThan(freeThrowChance(calm))
    expect(freeThrowChance(nervous, true)).toBeLessThan(freeThrowChance(nervous))
  })

  it('shields road players from the crowd (and home players feel none)', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    const calm = makePlayer({ id: 'c', attributes: { composure: 20 } })
    const nervous = makePlayer({ id: 'n', attributes: { composure: 1 } })
    expect(roadEdge(game.home, nervous)).toBe(0)
    expect(roadEdge(game.away, nervous)).toBeLessThan(roadEdge(game.away, calm))
    expect(roadEdge(game.away, calm)).toBeLessThan(0)
  })
})

describe('play-by-play convention', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('attributes blocks, steals and defensive fouls to the defense', () => {
    for (const r of GAMES) {
      r.playByPlay.forEach((entry, i) => {
        const prev = r.playByPlay[i - 1]
        if (!prev) return
        // A block or steal always directly follows the offense's miss or turnover.
        if (/ blocks /.test(entry.text) || / steal$/.test(entry.text)) {
          expect(entry.teamId).not.toBe(prev.teamId)
        }
      })
    }
  })

  it('logs a fouled make before the foul, and the foul before the free throw', () => {
    let andOnes = 0
    for (const r of GAMES) {
      r.playByPlay.forEach((entry, i) => {
        if (!/^Shooting foul/.test(entry.text)) return
        // The shooter's free throws come after the foul (a technical may slip in between).
        const next = r.playByPlay.slice(i + 1).find((e) => / free throw/.test(e.text))
        expect(next?.teamId).not.toBe(entry.teamId)
        const prev = r.playByPlay[i - 1]
        const isFieldGoal = prev && / makes /.test(prev.text) && !/free throw/.test(prev.text)
        // An and-one: the opponent's make, then this foul, then one free throw.
        if (isFieldGoal && prev.teamId !== entry.teamId) {
          andOnes++
          expect(next?.text).toMatch(/free throw$/)
        }
      })
    }
    expect(andOnes).toBeGreaterThan(20)
  })
})
