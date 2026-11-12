import type { Player } from '../players/types.ts'
import { adjustProbability, normalizeRating } from '../shared/probability.ts'
import { attemptFreeThrows, bestFreeThrowShooter } from './freeThrows.ts'
import { disqualify } from './lineup.ts'
import type { GameState, TeamState } from './state.ts'
import { isClutch, lineOf, log, opponentOf, shortName } from './state.ts'
import {
  BASE_TECHNICAL_PER_FOUL,
  TECHNICAL_CLOSE_GAME_EDGE,
  TECHNICAL_DISCIPLINE_WEIGHT,
  TECHNICAL_FOUL_TROUBLE_EDGE,
  TECHNICAL_TEMPERAMENT_WEIGHT,
  TENSE_MARGIN,
  TENSE_SECONDS,
} from './tuning.ts'

/**
 * Technical fouls. They're rolled right after a player is called for a personal foul (arguing
 * the call is by far the most common trigger), so fouls and technicals share one source of
 * tension: the more fouls, the more chances to lose your temper.
 */

/** True if the player is one foul (or less) from disqualification. */
function inFoulTrouble(game: GameState, team: TeamState, player: Player): boolean {
  return lineOf(team, player).personalFouls >= game.rules.personalFoulLimit - 1
}

/**
 * Chance the player picks up a technical after being called for a foul. Low Temperament (hidden)
 * and low Discipline raise it; a close, late game and foul trouble add tension.
 */
export function technicalChance(game: GameState, team: TeamState, player: Player): number {
  const tense = isClutch(game, TENSE_SECONDS, TENSE_MARGIN) ? TECHNICAL_CLOSE_GAME_EDGE : 0
  const trouble = inFoulTrouble(game, team, player) ? TECHNICAL_FOUL_TROUBLE_EDGE : 0
  const edge =
    -TECHNICAL_TEMPERAMENT_WEIGHT * normalizeRating(player.hidden.temperament) -
    TECHNICAL_DISCIPLINE_WEIGHT * normalizeRating(player.attributes.discipline) +
    tense +
    trouble
  return adjustProbability(BASE_TECHNICAL_PER_FOUL, edge)
}

/**
 * One technical free throw for the opponent of `team`, shot by their best free-throw shooter on
 * the floor. Play then continues as it was (no rebound, no change of possession).
 */
export function technicalFreeThrow(game: GameState, team: TeamState): void {
  const opponent = opponentOf(game, team)
  attemptFreeThrows(
    game,
    opponent,
    bestFreeThrowShooter(opponent.onCourt),
    1,
    'technical free throw',
  )
}

/** Charges a technical foul to a player: free throw for the opponent, ejection on the limit. */
export function assessTechnical(game: GameState, team: TeamState, player: Player): void {
  const line = lineOf(team, player)
  line.technicalFouls += 1
  log(game, team, `Technical foul on ${shortName(player)}`)
  technicalFreeThrow(game, team)
  // Some leagues (FIBA) count technicals toward the personal-foul limit as well.
  if (game.rules.technicalsCountTowardFoulLimit) line.personalFouls += 1
  if (line.technicalFouls >= game.rules.technicalFoulsToEject) {
    disqualify(game, team, player, 'ejected')
  } else if (line.personalFouls >= game.rules.personalFoulLimit) {
    disqualify(game, team, player, 'fouledOut')
  }
}

/** Rolls for a technical after a foul by `player`, and assesses it if it happens. */
export function maybeTechnical(game: GameState, team: TeamState, player: Player): void {
  if (game.rng.chance(technicalChance(game, team, player))) assessTechnical(game, team, player)
}
