/**
 * Late-game score effects, measured on real possessions (simulatePossession) rather than only on
 * the helper functions: intentional-foul targeting and its bonus sequence, the leader running
 * clock, the trailing team hurrying and hunting threes, and the tied team holding for the last shot.
 */
import { describe, expect, it } from 'vitest'
import { simulatePossession } from '../../../src/core/match/possession.ts'
import {
  awayFromPlayRuleApplies,
  canRunOutClock,
  endOfPeriodSeconds,
  intentionalFoulPlan,
  intentionalFoulSeconds,
  maxFoulingDeficit,
  threePointHuntFactor,
} from '../../../src/core/match/scoreEffects.ts'
import {
  THREE_HUNT_BOOST,
  THREE_HUNT_WINDOW_SECONDS,
  TYING_THREE_FACTOR,
  TYING_TWO_THREE_FACTOR,
} from '../../../src/core/match/tuning.ts'
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
  it('pro, last 2:00: foul the ball handler (away-from-the-play rule), shoot only in the bonus', () => {
    let brickTrips = 0
    for (let seed = 0; seed < 60; seed++) {
      const game = gameAt({ period: 4, clock: 25, homeLead: 6, home: teamWithBrickLayer(), seed })
      simulatePossession(game, game.home, game.away)
      const texts = game.playByPlay.map((e) => e.text)
      // Late-window rule: the first foul is a side-out, the second one shoots.
      expect(texts[0]).toMatch(/^Intentional foul on PB\d+$/)
      expect(texts[1]).toMatch(/^Intentional foul on PB\d+$/)
      expect(texts[2]).toMatch(/ (makes|misses) free throw 1 of 2$/)
      expect(game.playByPlay[0]?.teamId).toBe('B')
      if (texts[2]?.startsWith('Pbrick ')) brickTrips++
      expect(game.home.lines.get('benchBrick')?.freeThrowsAttempted).toBe(0)
    }
    // The ball handler is picked by handling skill, not by bad free-throw shooting: the brick
    // layer (a flat-rated wing) gets roughly his 1-in-5 share, far from every trip.
    expect(brickTrips).toBeLessThan(30)
  })

  it('FIBA (no away-from-the-play rule): target the worst free-throw shooter on the floor', () => {
    for (let seed = 0; seed < 20; seed++) {
      const game = gameAt({
        period: 4,
        clock: 25,
        homeLead: 6,
        home: teamWithBrickLayer(),
        rules: FIBA_RULES,
        seed,
      })
      simulatePossession(game, game.home, game.away)
      const tripIndex = game.playByPlay.findIndex((e) => / free throw 1 of 2$/.test(e.text))
      // Only a trip that follows an intentional foul says who the defense targeted: with
      // rotations the exact rng stream (and so the clock) shifts, and the bonus can also come from
      // a natural foul on the fifth team foul.
      const trip = game.playByPlay[tripIndex]
      const targeted = game.playByPlay[tripIndex - 1]?.text.startsWith('Intentional foul')
      if (trip && targeted) expect(trip.text).toMatch(/^Pbrick /)
      expect(game.home.lines.get('benchBrick')?.freeThrowsAttempted).toBe(0)
    }
  })

  it('need four free fouls before the bonus under FIBA (no late-window rule)', () => {
    let fullSequences = 0
    for (let seed = 0; seed < 30; seed++) {
      const game = gameAt({
        period: 4,
        clock: 28,
        homeLead: 6,
        home: teamWithBrickLayer(),
        rules: FIBA_RULES,
        seed,
      })
      simulatePossession(game, game.home, game.away)
      // Ignore technicals and foul-outs: one defender takes every intentional foul, so with
      // FIBA's 5-foul limit he can foul out (or pick up a technical) during the sequence.
      const texts = game.playByPlay
        .map((e) => e.text)
        .filter((t) => !/technical|Technical|fouls out/.test(t))
      const firstFreeThrow = texts.findIndex((t) => / free throw 1 of 2$/.test(t))
      // Four fouls never shoot; the fifth team foul does. The clock (which depends on the rng
      // stream, shifted by the coaches' substitution draws) can run out before the sequence
      // finishes, so a trip is only required to come no earlier than index 5.
      if (firstFreeThrow !== -1) expect(firstFreeThrow).toBeGreaterThanOrEqual(5)
      if (firstFreeThrow === 5) {
        fullSequences++
        expect(texts.slice(0, 4).every((t) => t.startsWith('Intentional foul'))).toBe(true)
      }
    }
    expect(fullSequences).toBeGreaterThan(0)
  })

  it('never come from the leading team, before the last 30 s, or beyond the shrinking cap', () => {
    // At 0:25 the cap is 3 + 25 / 6 ≈ 7: down 8 is over; down 3 with 25 s > 24 s shot clock
    // still plays defense; at 0:50 nobody fouls for extra possessions yet.
    for (const [homeLead, clock] of [
      [-6, 25],
      [3, 25],
      [8, 25],
      [6, 50],
    ] as const) {
      const game = gameAt({ period: 4, clock, homeLead })
      expect(intentionalFoulPlan(game, game.away, 24)).toBeUndefined()
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

describe('tie-seeking end-game play', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('a team down 1–3 fouls once the leader could run out the clock, not before', () => {
    for (const homeLead of [1, 2, 3]) {
      const late = gameAt({ period: 4, clock: 20, homeLead })
      expect(intentionalFoulPlan(late, late.away, 24)).toBe('stopClock')
      // 30 s left on a 24 s shot clock: the leader must still shoot, so play defense.
      const early = gameAt({ period: 4, clock: 30, homeLead })
      expect(intentionalFoulPlan(early, early.away, 24)).toBeUndefined()
    }
  })

  it('a team up exactly 3 fouls in the final seconds to deny the tying three', () => {
    /** The away (defending) team's plan with the home team leading by `homeLead`. */
    const plan = (clock: number, homeLead: number): string | undefined => {
      const game = gameAt({ period: 4, clock, homeLead })
      return intentionalFoulPlan(game, game.away, 24)
    }
    expect(plan(5, -3)).toBe('denyThree')
    expect(plan(5, -2)).not.toBe('denyThree')
    expect(plan(20, -3)).toBeUndefined()
    // Too little time to foul before the buzzer.
    expect(plan(0.8, -3)).toBeUndefined()
  })

  it('a leading team that can run out the clock holds the ball: no shot, period over', () => {
    for (let i = 0; i < 50; i++) {
      // Up 12: nobody fouls, so the leader just runs it out.
      const game = gameAt({ period: 4, clock: 20, homeLead: 12, seed: i })
      expect(canRunOutClock(game, game.home, 24)).toBe(true)
      simulatePossession(game, game.home, game.away)
      expect(game.clock).toBe(0)
      expect(game.playByPlay.map((e) => e.text)).toEqual(['Team A run out the clock'])
    }
  })

  it('every team holds for the last shot of Q1–Q3, whatever the score', () => {
    for (const homeLead of [-8, 0, 8]) {
      const game = gameAt({ period: 2, clock: 20, homeLead })
      expect(endOfPeriodSeconds(game, game.home, 6, 24, 5)).toBeCloseTo(18, 10)
    }
  })

  it('a team down one shot late shoots with ~5 s left; with no time for a set it heaves', () => {
    const down2 = gameAt({ period: 4, clock: 20, homeLead: -2 })
    expect(endOfPeriodSeconds(down2, down2.home, 6, 24, 5)).toBeCloseTo(15, 10)
    const down8 = gameAt({ period: 4, clock: 20, homeLead: -8 })
    expect(endOfPeriodSeconds(down8, down8.home, 6, 24, 5)).toBe(6)
    const noTime = gameAt({ period: 4, clock: 4, homeLead: 0 })
    expect(endOfPeriodSeconds(noTime, noTime.home, 6, 24, 5)).toBeUndefined()
  })

  it('a team down exactly 3 in the final seconds goes for the tying three', () => {
    const game = gameAt({ period: 4, clock: 20, homeLead: -3 })
    expect(threePointHuntFactor(game, game.home)).toBeGreaterThanOrEqual(TYING_THREE_FACTOR)
    expect(awayThreeShare({ period: 4, clock: 20, homeLead: 3 }, 400)).toBeGreaterThan(0.75)
  })

  it('intentional fouls rotate between defenders and never draw technicals', () => {
    let fouls = 0
    const foulers = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const game = gameAt({ period: 4, clock: 30, homeLead: 6, seed: i })
      for (let p = 0; p < 6 && game.clock > 0; p++) {
        simulatePossession(game, game.home, game.away)
        simulatePossession(game, game.away, game.home)
      }
      game.playByPlay.forEach((e, index) => {
        const match = /^Intentional foul on (\S+)/.exec(e.text)
        if (!match?.[1]) return
        fouls++
        foulers.add(match[1])
        // A technical is always logged right after the foul that drew it.
        expect(game.playByPlay[index + 1]?.text).not.toMatch(/^Technical foul/)
      })
    }
    expect(fouls).toBeGreaterThan(40)
    expect(foulers.size).toBeGreaterThanOrEqual(4)
  })
})

describe('tie-seeking end-game play (tester round 3)', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  // Pins the round-3 fix: the tying-shot factor overrides catch-up hunting, so the down-2
  // preference (< 1) actually lowers the three weight.
  it('a team down exactly 2 in the final seconds de-weights threes', () => {
    const game = gameAt({ period: 4, clock: 20, homeLead: -2 })
    expect(threePointHuntFactor(game, game.home)).toBeCloseTo(TYING_TWO_THREE_FACTOR, 10)
  })

  it('tie-seeking shot factors are off outside the final 30 s and before the final period', () => {
    const early = gameAt({ period: 4, clock: 31, homeLead: -3 })
    // Only the general catch-up hunting applies at 0:31.
    expect(threePointHuntFactor(early, early.home)).toBeCloseTo(
      1 + THREE_HUNT_BOOST * (1 - 31 / THREE_HUNT_WINDOW_SECONDS),
      10,
    )
    const q3 = gameAt({ period: 3, clock: 20, homeLead: -3 })
    expect(threePointHuntFactor(q3, q3.home)).toBe(1)
    const tied = gameAt({ period: 4, clock: 20, homeLead: 0 })
    expect(threePointHuntFactor(tied, tied.home)).toBe(1)
  })

  it('chase fouls also apply in overtime, never in Q1–Q3, and never by the leader', () => {
    const overtime = gameAt({ period: 5, clock: 20, homeLead: 2 })
    expect(intentionalFoulPlan(overtime, overtime.away, 24)).toBe('stopClock')
    const q3 = gameAt({ period: 3, clock: 20, homeLead: 2 })
    expect(intentionalFoulPlan(q3, q3.away, 24)).toBeUndefined()
    const leader = gameAt({ period: 4, clock: 20, homeLead: 2 })
    expect(intentionalFoulPlan(leader, leader.home, 24)).toBeUndefined()
    // The shot clock passed in decides when the leader could run it out (14 after a reset).
    const reset = gameAt({ period: 4, clock: 20, homeLead: 2 })
    expect(intentionalFoulPlan(reset, reset.away, 14)).toBeUndefined()
  })

  it('a team down 4 to the cap in the last 30 s fouls; down 11 it lets the leader run it out', () => {
    // Cap at 0:29 is 3 + 29 / 6 ≈ 7.8.
    for (const homeLead of [4, 7]) {
      const game = gameAt({ period: 4, clock: 29, homeLead })
      expect(intentionalFoulPlan(game, game.away, 24)).toBe('stopClock')
    }
    const down11 = gameAt({ period: 4, clock: 20, homeLead: 11 })
    expect(intentionalFoulPlan(down11, down11.away, 24)).toBeUndefined()
    expect(canRunOutClock(down11, down11.home, 24)).toBe(true)
  })

  it('deny-three window edges: on at 6 s, off just above it, and only at exactly +3', () => {
    const at6 = gameAt({ period: 4, clock: 6, homeLead: 3 })
    expect(intentionalFoulPlan(at6, at6.home, 24)).toBe('denyThree')
    const above = gameAt({ period: 4, clock: 6.01, homeLead: 3 })
    expect(intentionalFoulPlan(above, above.home, 24)).toBeUndefined()
    const up4 = gameAt({ period: 4, clock: 5, homeLead: 4 })
    expect(intentionalFoulPlan(up4, up4.home, 24)).toBeUndefined()
  })

  it('the leader fouls before the tying three goes up, and the foul never draws a technical', () => {
    let fouls = 0
    for (let i = 0; i < 60; i++) {
      // Home leads by 3; the away team has the ball with 5 s left.
      const game = gameAt({ period: 4, clock: 5, homeLead: 3, seed: 300 + i })
      simulatePossession(game, game.away, game.home)
      const first = game.playByPlay[0]
      // The log names the fouler, a player of the leading home team.
      expect(first?.text).toMatch(/^Intentional foul on PA\d+$/)
      expect(first?.teamId).toBe('A')
      expect(game.playByPlay[1]?.text ?? '').not.toMatch(/^Technical/)
      fouls++
    }
    expect(fouls).toBe(60)
  })

  it('running out the clock records no shot, no turnover and no rush penalty', () => {
    for (let i = 0; i < 30; i++) {
      const game = gameAt({ period: 5, clock: 13, homeLead: 15, seed: 700 + i })
      simulatePossession(game, game.home, game.away)
      expect(game.clock).toBe(0)
      const attempts = Object.values(game.home.shotsByPlayType).reduce((s, t) => s + t.attempted, 0)
      expect(attempts).toBe(0)
      expect(game.home.points).toBe(115)
    }
  })

  it('Q1–Q3: a team (even a leading one) holds and shoots inside the last 2 s', () => {
    for (const homeLead of [10, -10]) {
      for (let i = 0; i < 60; i++) {
        const game = gameAt({ period: 2, clock: 20, homeLead, seed: 900 + i })
        simulatePossession(game, game.home, game.away)
        // First logged event of the possession happens with ≤ 2 s left; no "run out the clock"
        // outside the final period.
        expect(game.playByPlay[0]?.clockSeconds).toBeLessThanOrEqual(2)
        expect(game.playByPlay.some((e) => /run out the clock/.test(e.text))).toBe(false)
      }
    }
  })
})

describe('away-from-the-play rule and the shrinking foul cap (tester fix pass)', () => {
  it('pro: applies from exactly 2:00 of the final period and overtime, never earlier', () => {
    expect(PRO_RULES.awayFromPlayFoulWindowSeconds).toBe(120)
    expect(awayFromPlayRuleApplies(gameAt({ period: 4, clock: 120, homeLead: 5 }))).toBe(true)
    expect(awayFromPlayRuleApplies(gameAt({ period: 4, clock: 120.1, homeLead: 5 }))).toBe(false)
    expect(awayFromPlayRuleApplies(gameAt({ period: 5, clock: 60, homeLead: 5 }))).toBe(true)
    expect(awayFromPlayRuleApplies(gameAt({ period: 5, clock: 121, homeLead: 5 }))).toBe(false)
    expect(awayFromPlayRuleApplies(gameAt({ period: 3, clock: 10, homeLead: 5 }))).toBe(false)
  })

  it('FIBA: never applies', () => {
    expect(FIBA_RULES.awayFromPlayFoulWindowSeconds).toBeNull()
    for (const period of [4, 5]) {
      const game = gameAt({ period, clock: 10, homeLead: 5, rules: FIBA_RULES })
      expect(awayFromPlayRuleApplies(game)).toBe(false)
    }
  })

  /** Share of a stop-the-clock sequence's free throws taken by the brick-layer (slot 2). */
  function brickShare(rules: LeagueRules): number {
    let brick = 0
    let total = 0
    for (let i = 0; i < 80; i++) {
      const game = gameAt({
        period: 4,
        clock: 25,
        homeLead: 6,
        home: teamWithBrickLayer(),
        seed: 40 + i,
        rules,
      })
      // The fouling (away) team is already in the bonus, so the first foul shoots in both leagues.
      game.away.teamFouls = rules.teamFoulsBeforePenalty
      simulatePossession(game, game.home, game.away)
      for (const line of game.home.lines.values()) {
        total += line.freeThrowsAttempted
        if (line.playerId === 'brick') brick += line.freeThrowsAttempted
      }
    }
    expect(total).toBeGreaterThan(0)
    return brick / total
  }

  it('pro, inside the window: fouls the ball handler, not the worst free-throw shooter', () => {
    // A flat wing is sometimes the handler, but nowhere near every time.
    expect(brickShare(PRO_RULES)).toBeLessThan(0.5)
  })

  it('FIBA: still hunts the worst free-throw shooter on the floor', () => {
    expect(brickShare(FIBA_RULES)).toBe(1)
  })

  it('the deficit cap is 3 + clock / 6: 8 at 0:30, 4 at 0:06', () => {
    expect(maxFoulingDeficit(gameAt({ period: 4, clock: 30, homeLead: 0 }))).toBeCloseTo(8, 10)
    expect(maxFoulingDeficit(gameAt({ period: 4, clock: 6, homeLead: 0 }))).toBeCloseTo(4, 10)
    /** The trailing (away) team's plan with `clock` left, down `deficit`, and a full shot clock. */
    const plan = (clock: number, deficit: number): string | undefined => {
      const game = gameAt({ period: 4, clock, homeLead: deficit })
      // A shot clock longer than the game clock can't be "run out", so only the cap decides.
      return intentionalFoulPlan(game, game.away, 0)
    }
    expect(plan(30, 8)).toBe('stopClock')
    expect(plan(30, 9)).toBeUndefined()
    expect(plan(30.1, 4)).toBeUndefined()
    expect(plan(6, 4)).toBe('stopClock')
    expect(plan(5.9, 4)).toBeUndefined()
    // Below 4 the extra-possession rule never applies (down 1–3 is the chase rule's job).
    expect(plan(20, 3)).toBeUndefined()
  })

  it('an intentional foul never runs past the buzzer', () => {
    for (let i = 0; i < 200; i++) {
      const clock = 1.05 + (i % 20) * 0.1
      const game = gameAt({ period: 4, clock, homeLead: 2, seed: i })
      const seconds = intentionalFoulSeconds(game)
      expect(seconds).toBeGreaterThanOrEqual(Math.min(1, clock))
      expect(seconds).toBeLessThanOrEqual(clock)
    }
  })
})
