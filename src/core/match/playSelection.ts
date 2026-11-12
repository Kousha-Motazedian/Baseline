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
import { HALF_COURT_PLAY_TYPES } from './types.ts'

/** Who takes the shot on this action, what kind of play it is, and who contests it. */
export interface PlayChoice {
  player: Player
  playType: PlayType
  contesters: Contesters
}

/** How the offense is choosing its play on this action. */
export interface PlayOptions {
  /** Base frequency of each play type (half-court sets or fast-break looks). */
  shares: Partial<Record<PlayType, number>>
  /** Multiplier on the help defender's share of the contest (1 = set half-court defense). */
  helpFactor: number
  /** Multiplier on the weight of threes (late-game three hunting; 1 = normal). */
  threeFactor: number
}

/** Normal half-court play selection. */
export const HALF_COURT_OPTIONS: PlayOptions = {
  shares: BASE_PLAY_SHARE,
  helpFactor: 1,
  threeFactor: 1,
}

/**
 * How attractive a play is: the league's base frequency, scaled up by how good the player is at
 * it and down by how well the defense can stop it.
 */
export function playWeight(
  player: Player,
  playType: PlayType,
  contesters: Contesters,
  shares: Partial<Record<PlayType, number>> = BASE_PLAY_SHARE,
): number {
  // Tendencies are derived from attributes for now (see design doc): a player with 18 Three-Point
  // shoots far more threes than one with 8. The defense side makes the offense attack weak
  // defenders and avoid elite ones (e.g. fewer drives into a great rim protector).
  // Why exp() of normalized ratings: adding the same amount to every offensive and defensive
  // rating multiplies every option's weight by the same factor, so a uniformly better league
  // keeps the same shot mix. Only *relative* strengths move the mix.
  const offense = normalizeRating(offensiveSkill(player, playType))
  const defense = normalizeRating(contestSkill(contesters, playType))
  return (
    (shares[playType] ?? 0) *
    Math.exp(PLAY_FIT_OFFENSE_WEIGHT * offense - PLAY_FIT_DEFENSE_WEIGHT * defense)
  )
}

/** Weight of one option under the given options, including any late-game three hunting. */
function optionWeight(choice: PlayChoice, options: PlayOptions): number {
  const weight = playWeight(choice.player, choice.playType, choice.contesters, options.shares)
  return choice.playType === 'three' ? weight * options.threeFactor : weight
}

/** Every play option for one player, each with the defenders who would contest it. */
function playerOptions(
  offense: TeamState,
  defense: TeamState,
  player: Player,
  options: PlayOptions,
): PlayChoice[] {
  const contesters = findContesters(offense, defense, player, options.helpFactor)
  return HALF_COURT_PLAY_TYPES.filter((t) => (options.shares[t] ?? 0) > 0).map((playType) => ({
    player,
    playType,
    contesters,
  }))
}

/** Sum of the weights of a player's play options: how attractive it is to get them the ball. */
function totalWeight(choices: readonly PlayChoice[], options: PlayOptions): number {
  return choices.reduce((sum, o) => sum + optionWeight(o, options), 0)
}

/**
 * Chooses the shooter and play type for one action.
 * Two steps: first who gets the shot, then which play they run. The player step compresses
 * their total weight (USAGE_EXPONENT < 1) because real teams can't funnel every shot to their
 * best player: defenses load up on him and teammates need touches. Without it, a player a few
 * points better than his teammates could take 50+ shots a game. Raising to a power keeps the
 * league-invariance property: scaling every weight by the same factor changes nothing.
 */
export function choosePlay(
  rng: Rng,
  offense: TeamState,
  defense: TeamState,
  options: PlayOptions = HALF_COURT_OPTIONS,
): PlayChoice {
  const byPlayer = offense.onCourt.map((player) => playerOptions(offense, defense, player, options))
  const chosen = pickWeighted(rng, byPlayer, (c) => totalWeight(c, options) ** USAGE_EXPONENT)
  return pickWeighted(rng, chosen, (o) => optionWeight(o, options))
}
