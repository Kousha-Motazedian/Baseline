import type { Player } from '../players/types.ts'
import type { GameState, TeamState } from './state.ts'
import { log, shortName } from './state.ts'
import { replacementFor, substitute } from './substitutions.ts'

/**
 * Who is on the floor when a player is disqualified. Ordinary substitutions are the coach's
 * decisions (substitutions.ts); a disqualification asks the coach for the replacement.
 */

/** Why a player has to leave the game. */
export type DisqualificationReason = 'fouledOut' | 'ejected'

/** True if the player fouled out or was ejected. */
export function isDisqualified(team: TeamState, player: Player): boolean {
  return team.disqualified.has(player.id)
}

/** Bench players who can still come in: not on the floor and not disqualified. */
export function eligibleBench(team: TeamState): Player[] {
  return team.team.roster.filter((p) => !team.onCourt.includes(p) && !isDisqualified(team, p))
}

/** Play-by-play wording for a disqualification. */
function leavesText(player: Player, reason: DisqualificationReason): string {
  return reason === 'fouledOut'
    ? `${shortName(player)} fouls out`
    : `${shortName(player)} is ejected`
}

/** True if a disqualified player with no replacement stays on the floor. */
function staysOnWithoutBench(
  game: GameState,
  team: TeamState,
  reason: DisqualificationReason,
): boolean {
  // A team is never reduced below one player, whatever the reason.
  if (team.onCourt.length === 1) return true
  // An ejected player always leaves (the pro "stays on" exception is only for foul-outs).
  return reason === 'fouledOut' && game.rules.noBenchDisqualification === 'staysOn'
}

/**
 * Removes a disqualified player. The coach's replacement (tactics/rotation.ts, from the depth
 * chart) takes his lineup slot; with nobody left, an ejected player always leaves and the team
 * plays short-handed, while a fouled-out player follows the league rule: he stays on (pro,
 * further fouls become technicals) or the team plays short-handed (FIBA). A team is never
 * reduced below one player.
 */
export function disqualify(
  game: GameState,
  team: TeamState,
  player: Player,
  reason: DisqualificationReason,
): void {
  team.disqualified.add(player.id)
  const slot = team.onCourt.indexOf(player)
  if (slot === -1) return
  const replacement = replacementFor(game, team, slot)
  if (replacement) {
    substitute(team, slot, replacement)
    log(game, team, `${leavesText(player, reason)}; ${shortName(replacement)} checks in`)
    return
  }
  if (staysOnWithoutBench(game, team, reason)) {
    log(game, team, `${leavesText(player, reason)} but stays in: no eligible substitutes`)
    return
  }
  team.onCourt.splice(slot, 1)
  log(
    game,
    team,
    `${leavesText(player, reason)}; ${team.team.name} play with ${team.onCourt.length}`,
  )
}
