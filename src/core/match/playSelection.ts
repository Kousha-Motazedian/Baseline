import type { Player } from '../players/types.ts'
import { normalizeRating } from '../shared/probability.ts'
import type { Rng } from '../shared/rng.ts'
import { pickWeighted } from '../shared/weighted.ts'
import type { Contesters } from './contest.ts'
import { contestSkill, findContesters } from './contest.ts'
import { offensiveSkill } from './ratings.ts'
import type { TeamState } from './state.ts'
import {
  BASE_PLAY_SHARE,
  PLAY_FIT_DEFENSE_WEIGHT,
  PLAY_FIT_OFFENSE_WEIGHT,
  USAGE_EXPONENT,
} from './tuning.ts'
import type { PlayType } from './types.ts'
import { PLAY_TYPES } from './types.ts'

/** Who takes the shot on this action, what kind of play it is, and who contests it. */
export interface PlayChoice {
  player: Player
  playType: PlayType
  contesters: Contesters
}

/**
 * How attractive a play is: the league's base frequency, scaled up by how good the player is at
 * it and down by how well the defense can stop it.
 */
export function playWeight(player: Player, playType: PlayType, contesters: Contesters): number {
  // Tendencies are derived from attributes for now (see design doc): a player with 18 Three-Point
  // shoots far more threes than one with 8. The defense side makes the offense attack weak
  // defenders and avoid elite ones (e.g. fewer drives into a great rim protector).
  // Why exp() of normalized ratings: adding the same amount to every offensive and defensive
  // rating multiplies every option's weight by the same factor, so a uniformly better league
  // keeps the same shot mix. Only *relative* strengths move the mix.
  const offense = normalizeRating(offensiveSkill(player, playType))
  const defense = normalizeRating(contestSkill(contesters, playType))
  return (
    BASE_PLAY_SHARE[playType] *
    Math.exp(PLAY_FIT_OFFENSE_WEIGHT * offense - PLAY_FIT_DEFENSE_WEIGHT * defense)
  )
}

/** Every play option for one player, each with the defenders who would contest it. */
function playerOptions(offense: TeamState, defense: TeamState, player: Player): PlayChoice[] {
  const contesters = findContesters(offense, defense, player)
  return PLAY_TYPES.map((playType) => ({ player, playType, contesters }))
}

/** Sum of the weights of a player's play options: how attractive it is to get them the ball. */
function totalWeight(options: readonly PlayChoice[]): number {
  return options.reduce((sum, o) => sum + playWeight(o.player, o.playType, o.contesters), 0)
}

/**
 * Chooses the shooter and play type for one action.
 * Two steps: first who gets the shot, then which play they run. The player step compresses
 * their total weight (USAGE_EXPONENT < 1) because real teams can't funnel every shot to their
 * best player: defenses load up on him and teammates need touches. Without it, a player a few
 * points better than his teammates could take 50+ shots a game. Raising to a power keeps the
 * league-invariance property: scaling every weight by the same factor changes nothing.
 */
export function choosePlay(rng: Rng, offense: TeamState, defense: TeamState): PlayChoice {
  const byPlayer = offense.onCourt.map((player) => playerOptions(offense, defense, player))
  const chosen = pickWeighted(rng, byPlayer, (options) => totalWeight(options) ** USAGE_EXPONENT)
  return pickWeighted(rng, chosen, (o) => playWeight(o.player, o.playType, o.contesters))
}
