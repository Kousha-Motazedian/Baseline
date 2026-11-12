import type { Player } from '../players/types.ts'
import type { GameState, TeamState } from './state.ts'
import { lineOf, log, shortName } from './state.ts'

/** Records a personal foul and substitutes the player out if they've reached the foul limit. */
export function recordFoul(game: GameState, team: TeamState, player: Player): void {
  const line = lineOf(team, player)
  line.personalFouls += 1
  log(game, team, `Shooting foul on ${shortName(player)}`)
  if (line.personalFouls >= game.rules.personalFoulLimit) foulOut(game, team, player)
}

/** Bench players who can still come in: not on the floor and not fouled out themselves. */
function eligibleBench(game: GameState, team: TeamState): Player[] {
  return team.team.roster.filter(
    (p) =>
      !team.onCourt.includes(p) && lineOf(team, p).personalFouls < game.rules.personalFoulLimit,
  )
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

/** Removes a fouled-out player and brings in a similar-sized bench player in their lineup slot. */
function foulOut(game: GameState, team: TeamState, player: Player): void {
  const replacement = closestReplacement(eligibleBench(game, team), player)
  // Nobody left to come in: the player stays on (real leagues handle this with a technical foul).
  if (!replacement) return

  const slot = team.onCourt.indexOf(player)
  team.onCourt[slot] = replacement
  log(game, team, `${shortName(player)} fouls out; ${shortName(replacement)} checks in`)
}
