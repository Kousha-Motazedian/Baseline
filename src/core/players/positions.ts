import { clamp } from '../shared/probability.ts'
import type { Measurables, VisibleAttributeKey, VisibleAttributes } from './attributes.ts'
import { ATTRIBUTE_MAX, ATTRIBUTE_MIN } from './attributes.ts'

/**
 * Position ratings: how well a player fits each of the five positions, on the 1–20 scale.
 * Computed from attributes and measurables, never stored (docs/design/player-roles.md).
 */

/** The five traditional positions, in lineup-slot order. */
export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const

/** One of the five positions. */
export type Position = (typeof POSITIONS)[number]

/** Attribute weights (unlisted attributes count 0). */
export type AttributeWeights = Partial<Record<VisibleAttributeKey, number>>

/** The parts of a player that positions, roles and Current Ability are computed from. */
export interface PlayerProfile {
  attributes: VisibleAttributes
  measurables: Measurables
}

/** A rating for each position. */
export type PositionRatings = Record<Position, number>

/**
 * Position-rating weights, heaviest first as in the design doc. Tuning data: the weights only
 * matter relative to each other within a position. Ball skills dominate the guard spots, shooting
 * and defense the wing, and size-related skills (interior defense, rebounding, blocks) the bigs.
 */
export const POSITION_WEIGHTS: Record<Position, AttributeWeights> = {
  PG: {
    ballHandling: 5,
    passing: 5,
    offensiveIq: 4,
    quickness: 3,
    speed: 2.5,
    threePoint: 2.5,
    perimeterDefense: 2,
    stealing: 1.5,
  },
  SG: {
    threePoint: 5,
    midRange: 3.5,
    driving: 3.5,
    offBallMovement: 3,
    ballHandling: 2.5,
    perimeterDefense: 2.5,
    quickness: 2,
  },
  SF: {
    perimeterDefense: 4,
    driving: 3.5,
    threePoint: 3,
    finishing: 3,
    offBallMovement: 2.5,
    strength: 2,
    defensiveRebounding: 2,
  },
  PF: {
    interiorDefense: 4,
    defensiveRebounding: 4,
    strength: 3.5,
    finishing: 3,
    postScoring: 2.5,
    // Stretch value: a forward who can space the floor is worth more, but less than at the wing.
    threePoint: 2,
    vertical: 2,
  },
  C: {
    interiorDefense: 5,
    shotBlocking: 5,
    defensiveRebounding: 4,
    offensiveRebounding: 3,
    strength: 3,
    finishing: 2.5,
    vertical: 2,
  },
}

/**
 * The typical attribute shape of a player at each position: how far each attribute sits above or
 * below the player's overall level, in rating points (unlisted attributes are 0). Two users:
 * - the generator builds players from it (centering it first, so a position changes the *shape*
 *   of a player's ratings, not their level);
 * - roles judge a player against it, so a role reflects what stands out compared with a typical
 *   player at his position (a center who shoots like an average center isn't a Stretch Big).
 * Started from the old generator's guard/wing/big biases: PG and SG split the guard (PG leans to
 * passing and handling, SG to shooting), SF is the wing, PF and C split the big (PF more mobile
 * and a shooter, C the rim protector and rebounder).
 */
export const POSITION_PROFILES: Record<Position, AttributeWeights> = {
  PG: {
    driving: 1.5,
    finishing: -1,
    postScoring: -4,
    midRange: 0.5,
    threePoint: 1.5,
    freeThrow: 1.5,
    ballHandling: 4.5,
    passing: 4.5,
    perimeterDefense: 1,
    interiorDefense: -3.5,
    stealing: 2,
    shotBlocking: -4,
    offensiveRebounding: -3.5,
    defensiveRebounding: -3,
    speed: 3,
    quickness: 3,
    strength: -3,
    vertical: -0.5,
    offensiveIq: 1.5,
  },
  SG: {
    driving: 2.5,
    postScoring: -3,
    midRange: 2.5,
    threePoint: 3.5,
    freeThrow: 1.5,
    ballHandling: 1.5,
    passing: 0.5,
    offBallMovement: 2.5,
    perimeterDefense: 1.5,
    interiorDefense: -2.5,
    stealing: 1,
    shotBlocking: -3,
    offensiveRebounding: -2.5,
    defensiveRebounding: -2,
    speed: 2,
    quickness: 2,
    strength: -2,
  },
  SF: {
    driving: 1.5,
    finishing: 1.5,
    postScoring: -1,
    midRange: 0.5,
    threePoint: 1,
    ballHandling: -1,
    passing: -0.5,
    offBallMovement: 1.5,
    perimeterDefense: 2.5,
    interiorDefense: 0,
    stealing: 1,
    shotBlocking: -0.5,
    defensiveRebounding: 1,
    speed: 1,
    strength: 1.5,
    vertical: 1.5,
  },
  PF: {
    driving: -1,
    finishing: 1.5,
    postScoring: 2,
    midRange: 0.5,
    threePoint: 0,
    freeThrow: -0.5,
    ballHandling: -2,
    passing: -0.5,
    perimeterDefense: -1,
    interiorDefense: 1.5,
    stealing: -1,
    shotBlocking: 0.5,
    offensiveRebounding: 1.5,
    defensiveRebounding: 2.5,
    speed: -1,
    quickness: -1.5,
    strength: 3,
    vertical: 1,
  },
  C: {
    driving: -3,
    finishing: 3,
    postScoring: 3.5,
    midRange: -1.5,
    threePoint: -3.5,
    freeThrow: -2.5,
    ballHandling: -4,
    passing: -1.5,
    perimeterDefense: -3,
    interiorDefense: 4,
    stealing: -2,
    shotBlocking: 4.5,
    offensiveRebounding: 4.5,
    defensiveRebounding: 4.5,
    speed: -3,
    quickness: -3,
    strength: 4,
    vertical: 1,
  },
}

/**
 * How a position judges a body. `idealMinCm`..`idealMaxCm` is the "effective height" range with no
 * penalty. Outside it, the penalty grows smoothly towards `maxShortPenalty` / `maxTallPenalty`
 * (fractions of the rating above 1) with a spread of `shortScaleCm` / `tallScaleCm`.
 */
interface BodyCurve {
  idealMinCm: number
  idealMaxCm: number
  shortScaleCm: number
  maxShortPenalty: number
  tallScaleCm: number
  maxTallPenalty: number
  /** How much wingspan beyond a typical +7 cm counts as extra height. */
  wingspanWeight: number
}

/**
 * Body curves per position. Why these shapes: being too short hurts more the closer a position
 * plays to the rim (a short center is heavily penalised, a short point guard not at all), while
 * being too tall only mildly hurts the guard spots (slower feet, harder to handle low). Wingspan
 * matters most for centers (rim protection, rebounding reach).
 */
const BODY_CURVES: Record<Position, BodyCurve> = {
  PG: {
    idealMinCm: 170,
    idealMaxCm: 196,
    shortScaleCm: 10,
    maxShortPenalty: 0.2,
    tallScaleCm: 12,
    maxTallPenalty: 0.3,
    wingspanWeight: 0.2,
  },
  SG: {
    idealMinCm: 191,
    idealMaxCm: 200,
    shortScaleCm: 8,
    maxShortPenalty: 0.3,
    tallScaleCm: 12,
    maxTallPenalty: 0.3,
    wingspanWeight: 0.25,
  },
  SF: {
    idealMinCm: 199,
    idealMaxCm: 205,
    shortScaleCm: 9,
    maxShortPenalty: 0.45,
    tallScaleCm: 6,
    maxTallPenalty: 0.35,
    wingspanWeight: 0.3,
  },
  PF: {
    idealMinCm: 204,
    idealMaxCm: 210,
    shortScaleCm: 9,
    maxShortPenalty: 0.5,
    tallScaleCm: 7,
    maxTallPenalty: 0.25,
    wingspanWeight: 0.4,
  },
  C: {
    idealMinCm: 210,
    idealMaxCm: 230,
    shortScaleCm: 9,
    maxShortPenalty: 0.55,
    tallScaleCm: 15,
    maxTallPenalty: 0,
    wingspanWeight: 0.5,
  },
}

/** An inclusive height range in cm. */
interface HeightRange {
  minCm: number
  maxCm: number
}

/**
 * Hard height limits per position (actual height, inclusive). Outside its range a player can
 * never have the position as primary or among positions played, whatever his skills; inside it,
 * the soft body curve above still scales his fit. Why hard limits on top of the curve: the curve
 * alone let skills outweigh size (a 6'3" rebounder as a "C"), which no coach would play. The
 * ranges cover what modern pro leagues actually field at each spot, from 5'9" point guards to
 * 7'6" centers, with generous overlap so versatile players keep two positions.
 */
export const HEIGHT_LIMITS: Record<Position, HeightRange> = {
  PG: { minCm: 175, maxCm: 206 },
  SG: { minCm: 185, maxCm: 206 },
  SF: { minCm: 193, maxCm: 208 },
  PF: { minCm: 198, maxCm: 213 },
  C: { minCm: 201, maxCm: 229 },
}

/** Rating given to a position the player's height rules out (below the 1–20 scale on purpose). */
export const INELIGIBLE_RATING = 0

/** Wingspan minus height of a typical pro player, in cm; longer arms than this count as height. */
const TYPICAL_WINGSPAN_EXTRA_CM = 7

/**
 * How close (in rating points) the first extra position must be to the best one to count among
 * "positions played"; each further position needs a smaller gap (see positionsPlayed). Tuned so
 * about half of a generated league is dual-eligible and under 3% play three positions, as in a
 * real league.
 */
export const POSITIONS_PLAYED_MARGIN = 1.2

/**
 * How far below the best rating a skipped middle position may be (see bridgesGap). Tuned so a
 * generated league has only a handful of PG/SF players (2.65 per league measured over 20 leagues).
 */
export const SKIPPED_POSITION_MARGIN = 1.5

/**
 * Weighted average of `values` over the weighted attributes. Values missing from `values` count as
 * 0, so it also works on profile offsets (POSITION_PROFILES), not just full attribute sets.
 */
export function weightedAverage(
  values: Partial<Record<VisibleAttributeKey, number>>,
  weights: AttributeWeights,
): number {
  let total = 0
  let weightSum = 0
  for (const [key, weight] of Object.entries(weights) as [VisibleAttributeKey, number][]) {
    total += (values[key] ?? 0) * weight
    weightSum += weight
  }
  return weightSum === 0 ? 0 : total / weightSum
}

/** Height adjusted for arm length, as a position sees it. */
function effectiveHeightCm(measurables: Measurables, curve: BodyCurve): number {
  const extraReach = measurables.wingspanCm - measurables.heightCm - TYPICAL_WINGSPAN_EXTRA_CM
  return measurables.heightCm + extraReach * curve.wingspanWeight
}

/**
 * Smooth penalty for being `distanceCm` outside the ideal range: 0 at the edge, rising like a
 * bell curve turned upside down towards `maxPenalty`. Why this shape: it is flat near the ideal
 * range (an inch either way barely matters), steepest a few inches out, and levels off, so height
 * never becomes a hard cutoff.
 */
function softPenalty(distanceCm: number, scaleCm: number, maxPenalty: number): number {
  if (distanceCm <= 0) return 0
  return maxPenalty * (1 - Math.exp(-((distanceCm / scaleCm) ** 2)))
}

/** The fraction (0–1] of a player's skill rating a position keeps after judging his body. */
export function bodyFactor(measurables: Measurables, position: Position): number {
  const curve = BODY_CURVES[position]
  const height = effectiveHeightCm(measurables, curve)
  const short = softPenalty(curve.idealMinCm - height, curve.shortScaleCm, curve.maxShortPenalty)
  const tall = softPenalty(height - curve.idealMaxCm, curve.tallScaleCm, curve.maxTallPenalty)
  return 1 - short - tall
}

/**
 * The height eligibility is judged at: the actual height, pulled into the span all positions
 * cover together (175–229 cm). So a 5'7" or a 7'8" player still has a position (PG or C) instead
 * of none.
 */
function eligibilityHeightCm(measurables: Measurables): number {
  const limits = Object.values(HEIGHT_LIMITS)
  const lowest = Math.min(...limits.map((range) => range.minCm))
  const highest = Math.max(...limits.map((range) => range.maxCm))
  return clamp(measurables.heightCm, lowest, highest)
}

/** True if a player's height is inside a position's hard limits (see HEIGHT_LIMITS). */
export function isHeightEligible(measurables: Measurables, position: Position): boolean {
  const height = eligibilityHeightCm(measurables)
  const range = HEIGHT_LIMITS[position]
  return height >= range.minCm && height <= range.maxCm
}

/**
 * One position rating: 1–20, or INELIGIBLE_RATING outside the position's height limits. The body
 * factor scales the skill rating's distance above 1 (multiplicative rather than a flat deduction)
 * so a badly sized player can never be great at the position however good his skills are: a
 * 6'7" center with 20s everywhere tops out around 13, a decent small-ball center but never a
 * great one.
 */
export function positionRating(player: PlayerProfile, position: Position): number {
  if (!isHeightEligible(player.measurables, position)) return INELIGIBLE_RATING
  const skill = weightedAverage(player.attributes, POSITION_WEIGHTS[position])
  const rating = ATTRIBUTE_MIN + (skill - ATTRIBUTE_MIN) * bodyFactor(player.measurables, position)
  return clamp(rating, ATTRIBUTE_MIN, ATTRIBUTE_MAX)
}

/** Ratings for all five positions (unrounded; the UI rounds for display; 0 = ruled out by height). */
export function positionRatings(player: PlayerProfile): PositionRatings {
  const entries = POSITIONS.map((position) => [position, positionRating(player, position)])
  return Object.fromEntries(entries) as PositionRatings
}

/** The position with the highest rating; ties go to the earlier position in PG–C order. */
export function primaryPosition(ratings: PositionRatings): Position {
  let best: Position = 'PG'
  for (const position of POSITIONS) if (ratings[position] > ratings[best]) best = position
  return best
}

/**
 * The positions a player can play, in PG–C display order. The height-eligible positions are ranked
 * by rating (ties keep PG–C order, so the first is always the primary position), and the next one
 * is added while it is close enough to the best rating: the first extra position within
 * POSITIONS_PLAYED_MARGIN, the second within half that, the third within a third, and so on.
 *
 * Why a shrinking margin: dual eligibility is common, but a genuine three-position player is rare
 * (a few percent of a real league), so each extra position must fit almost as well as the best.
 * Why neighbouring positions aren't required: a 6'9" playmaker can be a real PG/SF without being a
 * great SG. But he must still be a passable SG: a position in the middle that is skipped must
 * rate within SKIPPED_POSITION_MARGIN of the best (see bridgesGap). Anyone who can play PG and SF
 * can play SG, so a PG/SF whose SG rating is poor is a quirk of the weights.
 */
export function positionsPlayed(ratings: PositionRatings): Position[] {
  // Positions the player's height rules out are never played, however low the bar.
  const ranked = POSITIONS.filter((position) => ratings[position] !== INELIGIBLE_RATING).sort(
    (a, b) => ratings[b] - ratings[a],
  )
  const primary = primaryPosition(ratings)
  const best = ratings[primary]
  const played: Position[] = [primary]
  for (const position of ranked.filter((p) => p !== primary)) {
    const extra = played.length
    if (ratings[position] < best - POSITIONS_PLAYED_MARGIN / extra) break
    // A failed gap skips only this candidate (no break): a lower-rated position next to one
    // already played may still qualify, and it does not use up an extra slot's margin.
    if (bridgesGap(ratings, played, position, best)) played.push(position)
  }
  return POSITIONS.filter((position) => played.includes(position))
}

/**
 * True if every position between `candidate` and the nearest position already played rates within
 * SKIPPED_POSITION_MARGIN of the best (an adjacent candidate has nothing in between).
 */
function bridgesGap(
  ratings: PositionRatings,
  played: readonly Position[],
  candidate: Position,
  best: number,
): boolean {
  const index = POSITIONS.indexOf(candidate)
  const distances = played.map((p) => Math.abs(POSITIONS.indexOf(p) - index))
  const nearest = POSITIONS.indexOf(played[distances.indexOf(Math.min(...distances))] as Position)
  const between = POSITIONS.slice(Math.min(index, nearest) + 1, Math.max(index, nearest))
  return between.every((p) => ratings[p] >= best - SKIPPED_POSITION_MARGIN)
}

/** Formats positions played for display, e.g. "PG/SG" or "SF/PF/C". */
export function formatPositions(positions: readonly Position[]): string {
  return positions.join('/')
}
