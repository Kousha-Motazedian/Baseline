/**
 * Helpers for running many seeded games and summarizing box scores in tests.
 */
import { simulateGame } from '../../src/core/match/game.ts'
import type { MatchResult, MatchTeam, PlayerLine, TeamResult } from '../../src/core/match/types.ts'
import type { LeagueRules } from '../../src/core/world/rules.ts'
import { PRO_RULES } from '../../src/core/world/rules.ts'

/** Numeric fields of a player box score line. */
export type LineField = Exclude<keyof PlayerLine, 'playerId' | 'name'>

/** Sums one numeric box score field across a team's player lines. */
export function teamTotal(team: TeamResult, field: LineField): number {
  return team.players.reduce((sum, line) => sum + line[field], 0)
}

/** Returns `team` and its opponent from a result, by team id. */
export function sides(result: MatchResult, teamId: string): [TeamResult, TeamResult] {
  return result.home.teamId === teamId ? [result.home, result.away] : [result.away, result.home]
}

/**
 * Plays `games` seeded games between two teams. Home court alternates by game index so the home
 * edge cancels out of any comparison between the two sides.
 */
export function playSeries(
  teamA: MatchTeam,
  teamB: MatchTeam,
  games: number,
  options: { seedOffset?: number; rules?: LeagueRules; alternateHome?: boolean } = {},
): MatchResult[] {
  const results: MatchResult[] = []
  for (let i = 0; i < games; i++) {
    const aIsHome = options.alternateHome === false || i % 2 === 0
    results.push(
      simulateGame({
        home: aIsHome ? teamA : teamB,
        away: aIsHome ? teamB : teamA,
        rules: options.rules ?? PRO_RULES,
        seed: (options.seedOffset ?? 0) + i,
      }),
    )
  }
  return results
}

/** Sums one field over a team (by id) across many games. */
export function seriesTotal(
  results: readonly MatchResult[],
  teamId: string,
  field: LineField,
): number {
  return results.reduce((sum, r) => sum + teamTotal(sides(r, teamId)[0], field), 0)
}

/** Sums one player's field (by player id) across many games. */
export function playerTotal(
  results: readonly MatchResult[],
  teamId: string,
  playerId: string,
  field: LineField,
): number {
  return results.reduce((sum, r) => {
    const line = sides(r, teamId)[0].players.find((l) => l.playerId === playerId)
    return sum + (line ? line[field] : 0)
  }, 0)
}

/** Arithmetic mean of a list of numbers. */
export function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length
}

/** Population standard deviation of a list of numbers. */
export function standardDeviation(values: readonly number[]): number {
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}

/** Total game length in seconds for a result, including any overtime periods. */
export function gameSeconds(result: MatchResult, rules: LeagueRules): number {
  const overtimes = result.periodsPlayed - rules.periods
  return rules.periods * rules.periodSeconds + overtimes * rules.overtimeSeconds
}

/**
 * Timeout for tests that simulate hundreds of games. They take 1–5 s on a laptop, close to
 * Vitest's 5 s default when files run in parallel, so they get explicit headroom.
 */
export const SLOW_TEST_TIMEOUT_MS = 30_000
