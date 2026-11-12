import type { Player } from '../players/types.ts'
import { adjustProbability, normalizeRating } from '../shared/probability.ts'
import { matchupEdge } from './contest.ts'
import { ballPressureSkill, ballSecuritySkill } from './ratings.ts'
import { personalEdge } from './situation.ts'
import type { GameState, TeamState } from './state.ts'
import { lineOf, log, shortName } from './state.ts'
import { BASE_STEAL_SHARE, BASE_TURNOVER } from './tuning.ts'

/** Chance the ball handler turns it over, from their ball security against the defender's pressure. */
export function turnoverChance(handler: Player, defender: Player, situationalEdge = 0): number {
  // Same matchup edge as shots, from the offense's point of view: a positive edge means the
  // handler is winning, which LOWERS the turnover chance, hence the minus sign.
  const edge =
    -matchupEdge(ballSecuritySkill(handler), ballPressureSkill(defender)) - situationalEdge
  return adjustProbability(BASE_TURNOVER, edge)
}

/** Chance a turnover was a steal by the defender (vs. a travel, bad pass out of bounds, etc.). */
export function stealChance(defender: Player): number {
  return adjustProbability(BASE_STEAL_SHARE, normalizeRating(defender.attributes.stealing))
}

/**
 * Rolls for a turnover on this action. If one happens, records it (and any steal) and returns true.
 */
export function tryTurnover(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  handler: Player,
  defender: Player,
): boolean {
  // Form and clutch composure apply to both players, so a hot defender forces more mistakes.
  const situational = personalEdge(game, offense, handler) - personalEdge(game, defense, defender)
  if (!game.rng.chance(turnoverChance(handler, defender, situational))) return false

  lineOf(offense, handler).turnovers += 1
  if (game.rng.chance(stealChance(defender))) {
    lineOf(defense, defender).steals += 1
    log(game, offense, `${shortName(handler)} turnover (stolen by ${shortName(defender)})`)
  } else {
    log(game, offense, `${shortName(handler)} turnover`)
  }
  return true
}
