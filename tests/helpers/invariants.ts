/**
 * Box score and play-by-play invariants every simulated game must satisfy. Shared by the
 * integrity, rules and edge-case tests so each scenario is checked the same way.
 */
import { expect } from 'vitest'
import type { MatchResult, PlayerLine, TeamResult } from '../../src/core/match/types.ts'
import { PLAY_TYPES } from '../../src/core/match/types.ts'
import type { LeagueRules } from '../../src/core/world/rules.ts'
import type { LineField } from './simulation.ts'
import { gameSeconds, teamTotal } from './simulation.ts'

/** Counting stats that must be non-negative integers. */
const COUNTING_FIELDS: readonly LineField[] = [
  'points',
  'fieldGoalsMade',
  'fieldGoalsAttempted',
  'threesMade',
  'threesAttempted',
  'freeThrowsMade',
  'freeThrowsAttempted',
  'offensiveRebounds',
  'defensiveRebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'personalFouls',
]

/** One player line: integer, non-negative stats with makes ≤ attempts and points that add up. */
function checkLine(line: PlayerLine): void {
  for (const field of COUNTING_FIELDS) {
    expect(Number.isInteger(line[field]), `${field} integer`).toBe(true)
    expect(line[field], field).toBeGreaterThanOrEqual(0)
  }
  expect(Number.isFinite(line.secondsPlayed)).toBe(true)
  expect(line.secondsPlayed).toBeGreaterThanOrEqual(0)
  expect(line.fieldGoalsMade).toBeLessThanOrEqual(line.fieldGoalsAttempted)
  expect(line.threesMade).toBeLessThanOrEqual(line.threesAttempted)
  expect(line.threesAttempted).toBeLessThanOrEqual(line.fieldGoalsAttempted)
  expect(line.threesMade).toBeLessThanOrEqual(line.fieldGoalsMade)
  expect(line.freeThrowsMade).toBeLessThanOrEqual(line.freeThrowsAttempted)
  expect(line.points).toBe(2 * line.fieldGoalsMade + line.threesMade + line.freeThrowsMade)
}

/** One team's totals: points, periods, play-type tallies and minutes all agree. */
function checkTeam(
  team: TeamResult,
  opponent: TeamResult,
  result: MatchResult,
  rules: LeagueRules,
): void {
  team.players.forEach(checkLine)
  expect(teamTotal(team, 'points')).toBe(team.points)
  expect(team.periodPoints).toHaveLength(result.periodsPlayed)
  expect(team.periodPoints.reduce((s, p) => s + p, 0)).toBe(team.points)
  for (const p of team.periodPoints) expect(p).toBeGreaterThanOrEqual(0)

  const tallies = PLAY_TYPES.map((t) => team.shotsByPlayType[t])
  expect(tallies.reduce((s, t) => s + t.attempted, 0)).toBe(teamTotal(team, 'fieldGoalsAttempted'))
  expect(tallies.reduce((s, t) => s + t.made, 0)).toBe(teamTotal(team, 'fieldGoalsMade'))
  expect(team.shotsByPlayType.three.attempted).toBe(teamTotal(team, 'threesAttempted'))
  expect(team.shotsByPlayType.three.made).toBe(teamTotal(team, 'threesMade'))

  // Five players on the floor for every second of the game (floating-point sums, hence toBeCloseTo).
  expect(teamTotal(team, 'secondsPlayed')).toBeCloseTo(5 * gameSeconds(result, rules), 6)

  // Labels can't outnumber the events they label.
  expect(teamTotal(team, 'assists')).toBeLessThanOrEqual(teamTotal(team, 'fieldGoalsMade'))
  expect(teamTotal(team, 'steals')).toBeLessThanOrEqual(teamTotal(opponent, 'turnovers'))
  const opponentMisses =
    teamTotal(opponent, 'fieldGoalsAttempted') - teamTotal(opponent, 'fieldGoalsMade')
  expect(teamTotal(team, 'blocks')).toBeLessThanOrEqual(opponentMisses)

  // Every missed field goal and every missed final free throw produces exactly one rebound, so the
  // rebounds on this team's misses sit between its FG misses and FG misses + FT misses.
  const missedFg = teamTotal(team, 'fieldGoalsAttempted') - teamTotal(team, 'fieldGoalsMade')
  const missedFt = teamTotal(team, 'freeThrowsAttempted') - teamTotal(team, 'freeThrowsMade')
  const rebounds = teamTotal(team, 'offensiveRebounds') + teamTotal(opponent, 'defensiveRebounds')
  expect(rebounds).toBeGreaterThanOrEqual(missedFg)
  expect(rebounds).toBeLessThanOrEqual(missedFg + missedFt)
}

/** Play-by-play runs forward in time, scores never drop, and the last line shows the final score. */
function checkPlayByPlay(result: MatchResult, rules: LeagueRules): void {
  const log = result.playByPlay
  const ids = new Set([result.home.teamId, result.away.teamId])
  for (let i = 0; i < log.length; i++) {
    const entry = log[i]
    const prev = log[i - 1]
    if (!entry) continue
    expect(ids.has(entry.teamId)).toBe(true)
    const length = entry.period > rules.periods ? rules.overtimeSeconds : rules.periodSeconds
    expect(entry.clockSeconds).toBeLessThanOrEqual(length)
    expect(entry.clockSeconds).toBeGreaterThanOrEqual(0)
    if (!prev) continue
    expect(entry.period).toBeGreaterThanOrEqual(prev.period)
    if (entry.period === prev.period)
      expect(entry.clockSeconds).toBeLessThanOrEqual(prev.clockSeconds)
    expect(entry.homeScore).toBeGreaterThanOrEqual(prev.homeScore)
    expect(entry.awayScore).toBeGreaterThanOrEqual(prev.awayScore)
  }
  const last = log.at(-1)
  expect(last?.homeScore).toBe(result.home.points)
  expect(last?.awayScore).toBe(result.away.points)
  expect(last?.period).toBe(result.periodsPlayed)
}

/** Possession counts: they alternate within a period, so they can differ by at most one per period. */
function checkPossessions(result: MatchResult, rules: LeagueRules): void {
  // Regulation: the tip winner starts Q1 and Q4, the other team Q2 and Q3, so the extra
  // possessions cancel to at most 2; each overtime can add one more.
  const overtimes = result.periodsPlayed - rules.periods
  const diff = Math.abs(result.home.possessions - result.away.possessions)
  expect(diff).toBeLessThanOrEqual(Math.ceil(rules.periods / 2) + overtimes)
}

/** Asserts every invariant on one finished game. */
export function expectValidResult(result: MatchResult, rules: LeagueRules): void {
  expect(result.periodsPlayed).toBeGreaterThanOrEqual(rules.periods)
  expect(result.home.points).not.toBe(result.away.points)
  checkTeam(result.home, result.away, result, rules)
  checkTeam(result.away, result.home, result, rules)
  checkPlayByPlay(result, rules)
  checkPossessions(result, rules)
}
