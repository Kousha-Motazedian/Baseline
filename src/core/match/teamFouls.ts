import type { GameState, TeamState } from './state.ts'
import { isOvertime } from './state.ts'

/**
 * Team fouls and the bonus ("penalty"). All counts and thresholds come from LeagueRules, so the
 * pro and FIBA systems (and any custom league) are just different data.
 */

/** True while the current period is inside the late-foul window (pro: last 2:00). */
function inLateWindow(game: GameState): boolean {
  const window = game.rules.lateFoulWindowSeconds
  return window !== null && game.clock <= window
}

/** Team fouls allowed in the current period before the bonus. */
function foulAllowance(game: GameState): number {
  const ownOvertimeCount = isOvertime(game) && !game.rules.overtimeTeamFoulsCarryOver
  return ownOvertimeCount
    ? game.rules.overtimeTeamFoulsBeforePenalty
    : game.rules.teamFoulsBeforePenalty
}

/**
 * True if the NEXT defensive foul by `team` is penalized with free throws (its opponent is in
 * the bonus): either it has used up the period's allowance, or (pro) it has already used its
 * late-window allowance.
 */
export function isInPenalty(game: GameState, team: TeamState): boolean {
  if (team.teamFouls >= foulAllowance(game)) return true
  return inLateWindow(game) && team.lateTeamFouls >= game.rules.lateFoulsBeforePenalty
}

/** Counts one team foul against `team`. */
export function addTeamFoul(game: GameState, team: TeamState): void {
  team.teamFouls += 1
  if (inLateWindow(game)) team.lateTeamFouls += 1
}

/**
 * Resets both teams' foul counts at the start of a period. Overtime keeps the running count when
 * the league carries fouls over (FIBA: every overtime continues Q4). The late-window count always
 * resets: it is per period by definition.
 */
export function resetTeamFouls(game: GameState): void {
  const carryOver = isOvertime(game) && game.rules.overtimeTeamFoulsCarryOver
  for (const team of [game.home, game.away]) {
    if (!carryOver) team.teamFouls = 0
    team.lateTeamFouls = 0
  }
}
