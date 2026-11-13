import type { Player } from '../players/types.ts'
import type { GameState, TeamState } from './state.ts'
import { log, shortName } from './state.ts'

/**
 * Who is on the floor: substitutions for disqualifications and (via foulTrouble.ts) foul
 * trouble. Each lineup slot has a regular (team.regulars); the player actually in the slot is
 * either that regular or a sub filling in for him.
 */

/** Why a player has to leave the game. */
export type DisqualificationReason = 'fouledOut' | 'ejected'

/** True if the player fouled out or was ejected. */
export function isDisqualified(team: TeamState, player: Player): boolean {
  return team.disqualified.has(player.id)
}

/** True if the player is some lineup slot's regular. */
export function isRegular(team: TeamState, player: Player): boolean {
  return team.regulars.includes(player)
}

/** Bench players who can still come in: not on the floor and not disqualified. */
export function eligibleBench(team: TeamState): Player[] {
  return team.team.roster.filter((p) => !team.onCourt.includes(p) && !isDisqualified(team, p))
}

/**
 * Picks the candidate closest in height to `player`, lowest tier first (tier = how suitable the
 * candidate is, from `tierOf`; undefined = not allowed). Positions aren't stored (see the
 * attributes design doc), so height is the simplest proxy for "same position": it keeps a big
 * replacing a big, so the slot-for-slot matchups stay sensible. Ties go to roster order.
 */
export function bestCandidate(
  candidates: readonly Player[],
  player: Player,
  tierOf: (p: Player) => number | undefined,
): Player | undefined {
  const gap = (p: Player): number => Math.abs(p.measurables.heightCm - player.measurables.heightCm)
  let best: Player | undefined
  let bestTier = Infinity
  for (const p of candidates) {
    const tier = tierOf(p)
    if (tier === undefined) continue
    if (tier < bestTier || (tier === bestTier && best !== undefined && gap(p) < gap(best))) {
      best = p
      bestTier = tier
    }
  }
  return best
}

/**
 * How suitable a bench player is to replace a disqualified player in `slot` (lower is better):
 *   0  the slot's own regular, free to play (he was only sitting with fouls)
 *   1  a reserve who isn't in foul trouble
 *   2  the slot's own regular, even in foul trouble
 *   3  a reserve in foul trouble
 *   4  another slot's regular sitting with fouls (last resort: his slot is then re-assigned)
 * Foul trouble only lowers the priority: a disqualification must be filled if anyone can play.
 */
function replacementTier(
  team: TeamState,
  slot: number,
  candidate: Player,
  inFoulTrouble: (p: Player) => boolean,
): number {
  const trouble = inFoulTrouble(candidate)
  if (candidate === team.regulars[slot]) return trouble ? 2 : 0
  if (!isRegular(team, candidate)) return trouble ? 3 : 1
  return 4
}

/** Puts `incoming` into a lineup slot (the player there goes to the bench). */
export function substitute(team: TeamState, slot: number, incoming: Player): void {
  team.onCourt[slot] = incoming
}

/**
 * Makes `incoming` the regular of `slot` after a disqualification. If he was another slot's
 * regular (sitting with fouls), that slot's current sub becomes its regular instead, so no player
 * is ever the regular of two slots.
 */
function promoteToRegular(team: TeamState, slot: number, incoming: Player): void {
  const formerSlot = team.regulars.indexOf(incoming)
  if (formerSlot !== -1 && formerSlot !== slot) {
    team.regulars[formerSlot] = team.onCourt[formerSlot] as Player
  }
  team.regulars[slot] = incoming
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
 * Removes a disqualified player. The best available bench player (see replacementTier) takes his
 * lineup slot; with nobody left, an ejected player always leaves and the team plays short-handed,
 * while a fouled-out player follows the league rule: he stays on (pro, further fouls become
 * technicals) or the team plays short-handed (FIBA). A team is never reduced below one player.
 *
 * `inFoulTrouble` lets the foul-trouble stopgap steer replacements away from players it is
 * resting; by default nobody is in foul trouble.
 */
export function disqualify(
  game: GameState,
  team: TeamState,
  player: Player,
  reason: DisqualificationReason,
  inFoulTrouble: (p: Player) => boolean = () => false,
): void {
  team.disqualified.add(player.id)
  const slot = team.onCourt.indexOf(player)
  if (slot === -1) return
  const replacement = bestCandidate(eligibleBench(team), player, (p) =>
    replacementTier(team, slot, p, inFoulTrouble),
  )
  if (replacement) {
    // A regular's replacement becomes the slot's regular; a sub's replacement just fills in.
    if (team.regulars[slot] === player) promoteToRegular(team, slot, replacement)
    substitute(team, slot, replacement)
    log(game, team, `${leavesText(player, reason)}; ${shortName(replacement)} checks in`)
    return
  }
  if (staysOnWithoutBench(game, team, reason)) {
    log(game, team, `${leavesText(player, reason)} but stays in: no eligible substitutes`)
    return
  }
  team.onCourt.splice(slot, 1)
  team.regulars.splice(slot, 1)
  log(
    game,
    team,
    `${leavesText(player, reason)}; ${team.team.name} play with ${team.onCourt.length}`,
  )
}
