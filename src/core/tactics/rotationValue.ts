import { CA_MAX, CA_MIN } from '../players/currentAbility.ts'
import type { Position, PositionRatings } from '../players/positions.ts'
import { INELIGIBLE_RATING, POSITIONS, positionRatings } from '../players/positions.ts'
import type { Player } from '../players/types.ts'
import { clamp, normalizeRating } from '../shared/probability.ts'
import type { HeadCoach } from '../staff/types.ts'
import { playerFit } from './fit.ts'
import {
  CLOSER_REAL_SHIFT,
  FIT_RATING_POINTS,
  INELIGIBLE_SLOT_COST,
  REPUTATION_SHARE_AT_PE_1,
  REPUTATION_SHARE_AT_PE_20,
  SLOT_MISFIT_WEIGHT,
  YOUTH_MAX_AGE,
  YOUTH_RATING_POINTS,
} from './rotationTuning.ts'
import type { TeamSystem } from './system.ts'

/** A player's position ratings with his best one, computed together. */
interface CachedRatings {
  ratings: PositionRatings
  best: number
}

/** Position ratings never change in a game, so they are computed once per player object. */
const ratingsCache = new WeakMap<Player, CachedRatings>()

/** The cached ratings entry for a player (the substitution logic asks at every dead ball). */
function cachedRatings(player: Player): CachedRatings {
  let entry = ratingsCache.get(player)
  if (!entry) {
    const ratings = positionRatings(player)
    // A plain loop: this is called from the hot substitution path.
    let best = -Infinity
    for (const position of POSITIONS) best = Math.max(best, ratings[position])
    entry = { ratings, best }
    ratingsCache.set(player, entry)
  }
  return entry
}

/** A player's five position ratings. */
export function ratingsOf(player: Player): PositionRatings {
  return cachedRatings(player).ratings
}

/** A player's best position rating (1-20). */
export function bestRating(player: Player): number {
  return cachedRatings(player).best
}

/**
 * Utility change (zero or negative) for a player filling a slot: a small cost for each rating
 * point below his best position, a flat large cost if his height rules the position out. This is
 * the "same position group replaces" rule in soft form, so a lineup is never forced to break
 * when no perfect match exists.
 */
export function slotCost(player: Player, position: Position): number {
  const rating = ratingsOf(player)[position]
  if (rating === INELIGIBLE_RATING) return -INELIGIBLE_SLOT_COST
  return -SLOT_MISFIT_WEIGHT * (bestRating(player) - rating)
}

/** Current Ability (1-100, reputation) on the 1-20 rating scale so it can blend with real value. */
export function reputationRating(player: Player): number {
  const ca = clamp(player.hidden.currentAbility, CA_MIN, CA_MAX)
  return 1 + ((ca - CA_MIN) * 19) / (CA_MAX - CA_MIN)
}

/**
 * What the player really brings, on the 1-20 scale: his best position rating plus his fit in the
 * system. Reads ratings and fit only (the engine's own inputs), never CA.
 */
export function realValue(player: Player, system: TeamSystem): number {
  const fit = playerFit(player, system)
  return bestRating(player) + (FIT_RATING_POINTS * (fit.offense + fit.defense)) / 2
}

/**
 * Reputation's share of a coach's perceived value: REPUTATION_SHARE_AT_PE_1 at Player Evaluation 1
 * falling linearly to REPUTATION_SHARE_AT_PE_20 at 20 (design decision 3).
 */
export function reputationShare(playerEvaluation: number): number {
  const t = clamp((playerEvaluation - 1) / 19, 0, 1)
  return REPUTATION_SHARE_AT_PE_1 + (REPUTATION_SHARE_AT_PE_20 - REPUTATION_SHARE_AT_PE_1) * t
}

/** Rating points of Works With Youth bonus (or penalty) for a young player; 0 for anyone older. */
export function youthBias(player: Player, worksWithYouth: number): number {
  if (player.measurables.age > YOUTH_MAX_AGE) return 0
  return YOUTH_RATING_POINTS * normalizeRating(worksWithYouth)
}

/** How a coach rates players: his Player Evaluation and Works With Youth (neutral without a coach). */
export interface Evaluator {
  playerEvaluation: number
  worksWithYouth: number
}

/** The evaluator of a coach, or a league-average one when the team has no head coach. */
export function evaluatorOf(coach: HeadCoach | undefined): Evaluator {
  return {
    playerEvaluation: coach?.attributes.playerEvaluation ?? 10.5,
    worksWithYouth: coach?.attributes.worksWithYouth ?? 10.5,
  }
}

/**
 * The coach's perceived value of a player: reputation blended with real value, plus the youth
 * bias. For the closing five (`closer`) the blend leans toward real value and the youth bias is
 * dropped: in the last minutes of a close game a coach trusts what he sees, not a prospect's
 * promise or a name.
 */
export function perceivedValue(
  player: Player,
  system: TeamSystem,
  evaluator: Evaluator,
  closer = false,
): number {
  const share = clamp(
    reputationShare(evaluator.playerEvaluation) - (closer ? CLOSER_REAL_SHIFT : 0),
    0,
    1,
  )
  const blend = share * reputationRating(player) + (1 - share) * realValue(player, system)
  return closer ? blend : blend + youthBias(player, evaluator.worksWithYouth)
}
