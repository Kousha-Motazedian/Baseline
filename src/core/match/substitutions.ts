import type { Player } from '../players/types.ts'
import type { PlayerGameStatus, SubstitutionContext } from '../tactics/rotation.ts'
import { chooseReplacement, decideSubstitutions } from '../tactics/rotation.ts'
import { energyOf } from './fatigue.ts'
import { leadSafety } from './leadSafety.ts'
import type { GameState, TeamState } from './state.ts'
import { leadOf, lineOf, log, shortName } from './state.ts'

/**
 * The engine's side of substitutions. The coach (tactics/rotation.ts) decides who comes in; this
 * module shows him the game, checks what he answers and applies it. The engine never lets a
 * disqualified or already-playing player in, whatever the coach says.
 */

/** Every roster player's status as the coach sees it. */
function statusOf(team: TeamState): Record<string, PlayerGameStatus> {
  const status: Record<string, PlayerGameStatus> = {}
  for (const player of team.team.roster) {
    const line = lineOf(team, player)
    status[player.id] = {
      energy: energyOf(team, player),
      secondsPlayed: line.secondsPlayed,
      personalFouls: line.personalFouls,
      disqualified: team.disqualified.has(player.id),
    }
  }
  return status
}

/** Everything a substitution decision for this team may look at, right now. */
export function substitutionContext(game: GameState, team: TeamState): SubstitutionContext {
  const lead = leadOf(game, team)
  return {
    rules: game.rules,
    period: game.period,
    clock: game.clock,
    lead,
    leadSafety: leadSafety(game, lead),
    roster: team.team.roster,
    onCourt: team.onCourt.map((p) => p.id),
    status: statusOf(team),
    plan: team.plan,
    coach: team.coach,
  }
}

/** True if the player can take the floor: on the roster, not on it already, not disqualified. */
function canCheckIn(team: TeamState, player: Player | undefined): player is Player {
  return player !== undefined && !team.onCourt.includes(player) && !team.disqualified.has(player.id)
}

/** The player with this id on the team's roster, if any. */
function rosterPlayer(team: TeamState, id: string): Player | undefined {
  return team.team.roster.find((p) => p.id === id)
}

/** Puts `incoming` into a lineup slot (the player there goes to the bench). */
export function substitute(team: TeamState, slot: number, incoming: Player): void {
  team.onCourt[slot] = incoming
}

/**
 * Asks the coach for substitutions at a dead ball and applies the valid ones (logged as
 * "X checks in for Y"). Anything invalid (bad slot, unknown, disqualified or already-playing
 * player, or a player named twice) is ignored.
 */
export function applySubstitutions(game: GameState, team: TeamState): void {
  const subs = decideSubstitutions(substitutionContext(game, team), game.rng)
  for (const sub of subs) {
    const outgoing = team.onCourt[sub.slot]
    const incoming = rosterPlayer(team, sub.incomingId)
    // canCheckIn also rejects a player already placed by an earlier sub in this batch.
    if (!outgoing || !canCheckIn(team, incoming)) continue
    substitute(team, sub.slot, incoming)
    log(game, team, `${shortName(incoming)} checks in for ${shortName(outgoing)}`)
  }
}

/** Dead-ball substitutions for both teams (home first; the order is fixed for determinism). */
export function applyBothSubstitutions(game: GameState): void {
  applySubstitutions(game, game.home)
  applySubstitutions(game, game.away)
}

/**
 * The coach's replacement for a player leaving `slot` (a disqualification). If the coach names
 * nobody valid while a legal player is available, the first one on the bench in roster order is
 * used: a disqualification must be filled if anyone can play.
 */
export function replacementFor(game: GameState, team: TeamState, slot: number): Player | undefined {
  const id = chooseReplacement(substitutionContext(game, team), slot)
  const chosen = id === undefined ? undefined : rosterPlayer(team, id)
  if (canCheckIn(team, chosen)) return chosen
  return team.team.roster.find((p) => canCheckIn(team, p))
}
