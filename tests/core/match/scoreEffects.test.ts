/**
 * Late-game score effects, measured on real possessions (simulatePossession) rather than only on
 * the helper functions: intentional-foul targeting and its bonus sequence, the leader running
 * clock, the trailing team hurrying and hunting threes, and the tied team holding for the last shot.
 */
import { describe, expect, it } from 'vitest'
import { simulatePossession } from '../../../src/core/match/possession.ts'
import type { GameState } from '../../../src/core/match/state.ts'
import type { MatchTeam } from '../../../src/core/match/types.ts'
import type { LeagueRules } from '../../../src/core/world/rules.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { makeFlatTeam, makePlayer } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'
import { mean, SLOW_TEST_TIMEOUT_MS } from '../../helpers/simulation.ts'

/** A moment of a game: period, clock and the home team's lead. */
interface Moment {
  period: number
  clock: number
  homeLead: number
  rules?: LeagueRules
  home?: MatchTeam
  seed?: number
}

/** A game state at a given moment, scores set so the home team leads by `homeLead`. */
function gameAt(moment: Moment): GameState {
  const game = makeGameState({
    home: moment.home ?? makeFlatTeam('A', 10.5),
    away: makeFlatTeam('B', 10.5),
    rules: moment.rules ?? PRO_RULES,
    period: moment.period,
    clock: moment.clock,
    seed: moment.seed ?? 1,
  })
  game.home.points = 100 + Math.max(0, moment.homeLead)
  game.away.points = 100 + Math.max(0, -moment.homeLead)
  return game
}

/** A home team whose worst free-throw shooter on the floor is slot 2 (a worse one sits on the bench). */
function teamWithBrickLayer(): MatchTeam {
  const team = makeFlatTeam('A', 10.5)
  team.roster[2] = makePlayer({ id: 'brick', heightCm: 201, attributes: { freeThrow: 3 } })
  team.roster[7] = makePlayer({ id: 'benchBrick', heightCm: 201, attributes: { freeThrow: 1 } })
  return team
}

describe('intentional fouls', () => {
  it('target the worst free-throw shooter on the floor and shoot only once in the bonus (pro)', () => {
    const game = gameAt({ period: 4, clock: 50, homeLead: 6, home: teamWithBrickLayer() })
    simulatePossession(game, game.home, game.away)
    const texts = game.playByPlay.map((e) => e.text)
    // Last 2:00 rule: the first foul is a side-out, the second one shoots.
    expect(texts[0]).toBe('Intentional foul on PB3')
    expect(texts[1]).toBe('Intentional foul on PB3')
    expect(texts[2]).toMatch(/^Pbrick (makes|misses) free throw 1 of 2$/)
    expect(game.playByPlay[0]?.teamId).toBe('B')
    expect(game.home.lines.get('brick')?.freeThrowsAttempted).toBe(2)
    expect(game.home.lines.get('benchBrick')?.freeThrowsAttempted).toBe(0)
  })

  it('need four free fouls before the bonus under FIBA (no late-window rule)', () => {
    const game = gameAt({
      period: 4,
      clock: 55,
      homeLead: 6,
      home: teamWithBrickLayer(),
      rules: FIBA_RULES,
    })
    simulatePossession(game, game.home, game.away)
    // Ignore technicals and foul-outs: one defender takes every intentional foul, so with FIBA's
    // 5-foul limit he can foul out (or pick up a technical) during the sequence.
    const texts = game.playByPlay
      .map((e) => e.text)
      .filter((t) => !/technical|Technical|fouls out/.test(t))
    const firstFreeThrow = texts.findIndex((t) => / free throw 1 of 2$/.test(t))
    expect(firstFreeThrow).toBe(5)
    expect(texts.slice(0, 5).every((t) => t.startsWith('Intentional foul'))).toBe(true)
  })

  it('never come from the leading team, or outside the 4–10 point window', () => {
    for (const homeLead of [-6, 3, 11]) {
      const game = gameAt({ period: 4, clock: 50, homeLead })
      simulatePossession(game, game.home, game.away)
      expect(game.playByPlay.some((e) => e.text.startsWith('Intentional foul'))).toBe(false)
    }
  })
})

/** Seconds each of `trials` possessions takes for the home (or away) offense at a given moment. */
function possessionSeconds(moment: Moment, offenseIsHome: boolean, trials: number): number[] {
  return Array.from({ length: trials }, (_, i) => {
    const game = gameAt({ ...moment, seed: 1_000 + i })
    const [offense, defense] = offenseIsHome ? [game.home, game.away] : [game.away, game.home]
    const before = game.clock
    simulatePossession(game, offense, defense)
    return before - game.clock
  })
}

/** Share of the away team's field-goal attempts that were threes over many possessions. */
function awayThreeShare(moment: Moment, trials: number): number {
  let threes = 0
  let attempts = 0
  for (let i = 0; i < trials; i++) {
    const game = gameAt({ ...moment, seed: 5_000 + i })
    simulatePossession(game, game.away, game.home)
    const tallies = Object.values(game.away.shotsByPlayType)
    attempts += tallies.reduce((s, t) => s + t.attempted, 0)
    threes += game.away.shotsByPlayType.three.attempted
  }
  return threes / attempts
}

describe('late-game pace and shot selection', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('the leading team takes longer possessions in the last 2:30 than mid-game', () => {
    const late = mean(possessionSeconds({ period: 4, clock: 140, homeLead: 8 }, true, 400))
    const midGame = mean(possessionSeconds({ period: 2, clock: 400, homeLead: 8 }, true, 400))
    expect(late).toBeGreaterThan(midGame + 3)
  })

  it('the trailing team hurries in the last 1:30', () => {
    const late = mean(possessionSeconds({ period: 4, clock: 85, homeLead: 8 }, false, 400))
    const midGame = mean(possessionSeconds({ period: 2, clock: 400, homeLead: 8 }, false, 400))
    expect(late).toBeLessThan(midGame - 3)
  })

  it('the trailing team takes a bigger share of threes late', () => {
    const late = awayThreeShare({ period: 4, clock: 30, homeLead: 3 }, 600)
    const midGame = awayThreeShare({ period: 2, clock: 400, homeLead: 3 }, 600)
    expect(late).toBeGreaterThan(midGame + 0.15)
  })

  it('a tied team holds for the last shot: its first action ends inside the last 2 seconds', () => {
    for (let i = 0; i < 100; i++) {
      const game = gameAt({ period: 4, clock: 20, homeLead: 0, seed: i })
      simulatePossession(game, game.home, game.away)
      expect(game.playByPlay[0]?.clockSeconds).toBeLessThanOrEqual(2)
    }
  })
})
