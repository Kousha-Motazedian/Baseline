import type { Player } from '../players/types.ts'
import type { GameState, TeamState } from './state.ts'
import { log, shortName } from './state.ts'

/** Why a player has to leave the game. */
export type DisqualificationReason = 'fouledOut' | 'ejected'

/** True if the player fouled out or was ejected. */
export function isDisqualified(team: TeamState, player: Player): boolean {
  return team.disqualified.has(player.id)
}

/** Bench players who can still come in: not on the floor and not disqualified. */
function eligibleBench(team: TeamState): Player[] {
  return team.team.roster.filter((p) => !team.onCourt.includes(p) && !isDisqualified(team, p))
}

/**
 * The bench player closest in height to the one leaving. Positions aren't stored (see the
 * attributes design doc), so height is the simplest proxy for "same position": it keeps a big
 * replacing a big, so the slot-for-slot matchups stay sensible. Ties go to roster order.
 */
function closestReplacement(candidates: readonly Player[], player: Player): Player | undefined {
  const gap = (p: Player): number => Math.abs(p.measurables.heightCm - player.measurables.heightCm)
  return candidates.reduce<Player | undefined>(
    (best, p) => (best === undefined || gap(p) < gap(best) ? p : best),
    undefined,
  )
}

/** Play-by-play wording for a disqualification. */
function leavesText(player: Player, reason: DisqualificationReason): string {
  return reason === 'fouledOut'
    ? `${shortName(player)} fouls out`
    : `${shortName(player)} is ejected`
}

/**
 * Removes a disqualified player. A similar-sized bench player takes his lineup slot; with nobody
 * left, the league rule decides: he stays on (pro, further fouls become technicals) or the team
 * plays short-handed (FIBA). A team is never reduced below one player.
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
  const replacement = closestReplacement(eligibleBench(team), player)
  if (replacement) {
    team.onCourt[slot] = replacement
    log(game, team, `${leavesText(player, reason)}; ${shortName(replacement)} checks in`)
    return
  }
  // Pro rule (and the last player standing anywhere): he stays on the floor.
  if (game.rules.noBenchDisqualification === 'staysOn' || team.onCourt.length === 1) {
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
