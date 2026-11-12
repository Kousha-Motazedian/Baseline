/**
 * Team fouls and the bonus, checked end to end: every defensive non-shooting foul in a simulated
 * game is replayed against a team-foul count rebuilt from the play-by-play, and must shoot free
 * throws exactly when the league's rules say so (period allowance, overtime allowance or
 * carry-over, and the pro last-2:00 rule).
 */
import { describe, expect, it } from 'vitest'
import { commitFoul } from '../../../src/core/match/fouls.ts'
import type { GameState } from '../../../src/core/match/state.ts'
import { addTeamFoul, isInPenalty, resetTeamFouls } from '../../../src/core/match/teamFouls.ts'
import { assessTechnical } from '../../../src/core/match/technicals.ts'
import type { MatchResult, MatchTeam } from '../../../src/core/match/types.ts'
import type { Player } from '../../../src/core/players/types.ts'
import type { LeagueRules } from '../../../src/core/world/rules.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { generatedPair, makeFlatTeam, patchTeam } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'
import { expectValidResult } from '../../helpers/invariants.ts'
import { BONUS_FOUL_KINDS, nextPlayLine, PERSONAL_FOUL_LINE } from '../../helpers/playByPlay.ts'
import { playSeries, SLOW_TEST_TIMEOUT_MS } from '../../helpers/simulation.ts'

/**
 * Pro rules with short periods. Rules are data, so this exercises the same code with far more
 * overtimes (small margins tie often) and a late window that covers most of each period.
 */
const SHORT_PRO: LeagueRules = {
  ...PRO_RULES,
  name: 'Short pro',
  periodSeconds: 150,
  lateFoulWindowSeconds: 60,
}

/** FIBA rules with short periods, for many overtimes (where Q4's team fouls carry over). */
const SHORT_FIBA: LeagueRules = { ...FIBA_RULES, name: 'Short FIBA', periodSeconds: 150 }

/** How often each rule path was exercised, so the test can prove it covered them. */
interface BonusCoverage {
  checked: number
  penalized: number
  overtime: number
  /** Overtime fouls penalized because the overtime allowance was used up (not the 2:00 rule). */
  overtimePenalized: number
  /** Penalized only because of the late-window rule (under the period allowance). */
  lateWindowOnly: number
}

/** The team-foul allowance for a period under `rules` (overtime has its own unless counts carry over). */
function allowance(rules: LeagueRules, period: number): number {
  const ownOvertimeCount = period > rules.periods && !rules.overtimeTeamFoulsCarryOver
  return ownOvertimeCount ? rules.overtimeTeamFoulsBeforePenalty : rules.teamFoulsBeforePenalty
}

/** True if a play-by-play line is the first of a two-shot penalty trip for the other team. */
function isPenaltyTrip(text: string, rules: LeagueRules): boolean {
  return new RegExp(`(makes|misses) free throw 1 of ${rules.penaltyFreeThrows}$`).test(text)
}

/** Running team-foul counts while replaying a game's log. */
interface FoulCounts {
  period: number
  inPeriod: Map<string, number>
  inWindow: Map<string, number>
}

/** Starts a new period's counts: overtime keeps the count only where the rules carry it over. */
function enterPeriod(counts: FoulCounts, period: number, rules: LeagueRules): void {
  const carry = period > rules.periods && rules.overtimeTeamFoulsCarryOver
  if (!carry) counts.inPeriod.clear()
  counts.inWindow.clear()
  counts.period = period
}

/**
 * Replays one game's fouls and checks every bonus decision. Every personal foul (shooting,
 * non-shooting, offensive, intentional) is a team foul; technicals never are.
 */
function checkBonusDecisions(result: MatchResult, rules: LeagueRules, cov: BonusCoverage): void {
  const counts: FoulCounts = { period: 0, inPeriod: new Map(), inWindow: new Map() }
  result.playByPlay.forEach((entry, i) => {
    if (entry.period !== counts.period) enterPeriod(counts, entry.period, rules)
    const match = PERSONAL_FOUL_LINE.exec(entry.text)
    if (!match?.[1]) return
    const team = entry.teamId
    const before = counts.inPeriod.get(team) ?? 0
    const lateBefore = counts.inWindow.get(team) ?? 0
    const window = rules.lateFoulWindowSeconds
    const inWindow = window !== null && entry.clockSeconds <= window
    const overAllowance = before >= allowance(rules, entry.period)
    const lateRule = inWindow && lateBefore >= rules.lateFoulsBeforePenalty
    if (BONUS_FOUL_KINDS.has(match[1])) {
      const expected = overAllowance || lateRule
      const next = nextPlayLine(result.playByPlay, i)
      const shoots = next !== undefined && next.teamId !== team && isPenaltyTrip(next.text, rules)
      expect(
        shoots,
        `${entry.text} (P${entry.period} ${entry.clockSeconds}s, ${before} before)`,
      ).toBe(expected)
      recordCoverage(cov, entry.period > rules.periods, overAllowance, lateRule && !overAllowance)
    }
    counts.inPeriod.set(team, before + 1)
    if (inWindow) counts.inWindow.set(team, lateBefore + 1)
  })
}

/** Tallies which rule paths a checked foul went through. */
function recordCoverage(
  cov: BonusCoverage,
  overtime: boolean,
  overAllowance: boolean,
  lateWindowOnly: boolean,
): void {
  cov.checked++
  if (overAllowance || lateWindowOnly) cov.penalized++
  if (overtime) cov.overtime++
  if (overtime && overAllowance) cov.overtimePenalized++
  if (lateWindowOnly) cov.lateWindowOnly++
}

/** Plays a series and checks every game's bonus decisions; returns the coverage. */
function replaySeries(home: MatchTeam, away: MatchTeam, games: number, rules: LeagueRules) {
  const cov: BonusCoverage = {
    checked: 0,
    penalized: 0,
    overtime: 0,
    overtimePenalized: 0,
    lateWindowOnly: 0,
  }
  for (const result of playSeries(home, away, games, { rules })) {
    expectValidResult(result, rules)
    checkBonusDecisions(result, rules, cov)
  }
  return cov
}

/** A pair of generated teams that foul a lot, so bonus situations come up often. */
function foulingPair(seed: number): [MatchTeam, MatchTeam] {
  const [home, away] = generatedPair(seed)
  return [patchTeam(home, { discipline: 4 }), patchTeam(away, { discipline: 4 })]
}

describe('bonus free throws in simulated games', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('pro: the 5th foul of a quarter shoots, the 2nd inside the last 2:00 shoots', () => {
    const [home, away] = foulingPair(31)
    const cov = replaySeries(home, away, 40, PRO_RULES)
    expect(cov.penalized).toBeGreaterThan(100)
    expect(cov.checked - cov.penalized).toBeGreaterThan(100)
    expect(cov.lateWindowOnly).toBeGreaterThan(5)
  })

  it('pro: each overtime has its own count and the 4th foul shoots (short periods, many OTs)', () => {
    const [home, away] = foulingPair(32)
    const cov = replaySeries(home, away, 300, SHORT_PRO)
    expect(cov.overtime).toBeGreaterThan(20)
    expect(cov.overtimePenalized).toBeGreaterThan(0)
    expect(cov.overtime - cov.overtimePenalized).toBeGreaterThan(0)
    expect(cov.lateWindowOnly).toBeGreaterThan(5)
  })

  it('FIBA: the 5th foul shoots, no late-window rule, overtime continues the Q4 count', () => {
    const [home, away] = foulingPair(33)
    const full = replaySeries(home, away, 30, FIBA_RULES)
    expect(full.lateWindowOnly).toBe(0)
    const short = replaySeries(home, away, 300, SHORT_FIBA)
    expect(short.overtime).toBeGreaterThan(10)
    expect(short.overtimePenalized).toBeGreaterThan(0)
  })
})

/** The player in a lineup slot (throws if missing, which would be a fixture bug). */
function slot(lineup: readonly Player[], index: number): Player {
  const player = lineup[index]
  if (!player) throw new Error(`no player in slot ${index}`)
  return player
}

/** A fresh game state between two flat teams at a chosen moment. */
function stateAt(rules: LeagueRules, period: number, clock: number): GameState {
  return makeGameState({
    home: makeFlatTeam('A', 10),
    away: makeFlatTeam('B', 10),
    rules,
    period,
    clock,
  })
}

/** Commits `count` fouls by the home team and returns the "was in the bonus" flag of each. */
function homeFouls(game: GameState, count: number): boolean[] {
  return Array.from({ length: count }, (_, i) =>
    commitFoul(game, game.home, slot(game.home.onCourt, i % 5), 'Holding foul'),
  )
}

describe('bonus thresholds at exact counts', () => {
  it('pro Q4 last 2:00: the 1st window foul is free, the 2nd shoots, whatever the period count', () => {
    const game = stateAt(PRO_RULES, 4, 300)
    homeFouls(game, 1)
    game.clock = 90
    expect(homeFouls(game, 3)).toEqual([false, true, true])
  })

  it('pro: a team already in the bonus stays in it inside the last 2:00', () => {
    const game = stateAt(PRO_RULES, 2, 400)
    homeFouls(game, 4)
    game.clock = 30
    expect(homeFouls(game, 1)).toEqual([true])
  })

  it('pro overtime: fouls 1–3 are free, the 4th shoots; the 2:00 rule applies there too', () => {
    const early = stateAt(PRO_RULES, 5, 300)
    resetTeamFouls(early)
    expect(homeFouls(early, 5)).toEqual([false, false, false, true, true])
    const late = stateAt(PRO_RULES, 5, 100)
    resetTeamFouls(late)
    expect(homeFouls(late, 2)).toEqual([false, true])
  })

  it('pro: a new period (and the late-window count) starts from zero', () => {
    const game = stateAt(PRO_RULES, 1, 60)
    homeFouls(game, 6)
    game.period = 2
    game.clock = 60
    resetTeamFouls(game)
    expect(game.home.teamFouls).toBe(0)
    expect(game.home.lateTeamFouls).toBe(0)
    expect(homeFouls(game, 2)).toEqual([false, true])
  })

  it('FIBA: no late-window rule, the 5th foul shoots even at 0:30', () => {
    const game = stateAt(FIBA_RULES, 4, 30)
    expect(homeFouls(game, 6)).toEqual([false, false, false, false, true, true])
  })

  it('FIBA: a second overtime still carries the running count from Q4', () => {
    const game = stateAt(FIBA_RULES, 4, 100)
    homeFouls(game, 2)
    game.period = 5
    resetTeamFouls(game)
    homeFouls(game, 1)
    game.period = 6
    resetTeamFouls(game)
    expect(game.home.teamFouls).toBe(3)
    expect(homeFouls(game, 2)).toEqual([false, true])
  })

  it('technicals are never team fouls (pro or FIBA)', () => {
    for (const rules of [PRO_RULES, FIBA_RULES]) {
      const game = stateAt(rules, 1, 500)
      foulsWithoutLog(game, 3)
      assessTechnical(game, game.home, slot(game.home.onCourt, 0))
      expect(game.home.teamFouls).toBe(3)
      expect(isInPenalty(game, game.home)).toBe(false)
    }
  })
})

/** Adds team fouls directly (no personal fouls, no play-by-play). */
function foulsWithoutLog(game: GameState, count: number): void {
  for (let i = 0; i < count; i++) addTeamFoul(game, game.home)
}
