import { clamp } from '../shared/probability.ts'
import type { VisibleAttributeKey } from './attributes.ts'
import { VISIBLE_ATTRIBUTE_KEYS } from './attributes.ts'
import type { AttributeWeights, PlayerProfile, Position } from './positions.ts'
import {
  bodyFactor,
  isHeightEligible,
  POSITION_WEIGHTS,
  POSITIONS,
  weightedAverage,
} from './positions.ts'

/**
 * Current Ability (CA): one 1–100 number for how good a player is today. It is the player's
 * position-weighted ability score at his best position (normally his primary one), mapped onto
 * 1–100. Computed, never rolled (docs/design/player-roles.md, section 3). The match engine never
 * reads it.
 */

/**
 * Baseline CA weight of every visible attribute, before the position's own emphasis is added.
 * Decisions:
 * - Work Ethic (development) and Leadership (morale) are excluded: they don't make a player better
 *   on the court today. Hidden attributes are excluded simply by not being visible attributes.
 * - Stamina and Durability get light weight: they matter over a season more than in a possession.
 * - Offensive and Defensive IQ weigh a bit extra: decision-making wins games at every position.
 * - Aggression and Discipline are double-edged (fouls drawn vs. committed), so they count less.
 */
const BASE_CA_WEIGHTS: Record<VisibleAttributeKey, number> = {
  driving: 1,
  finishing: 1,
  postScoring: 1,
  midRange: 1,
  threePoint: 1,
  freeThrow: 0.75,
  ballHandling: 1,
  passing: 1,
  offBallMovement: 1,
  perimeterDefense: 1,
  interiorDefense: 1,
  stealing: 1,
  shotBlocking: 1,
  offensiveRebounding: 1,
  defensiveRebounding: 1,
  speed: 1,
  quickness: 1,
  strength: 1,
  vertical: 1,
  stamina: 0.4,
  durability: 0.4,
  offensiveIq: 1.5,
  defensiveIq: 1.5,
  composure: 1,
  hustle: 0.75,
  teamwork: 1,
  leadership: 0,
  aggression: 0.5,
  discipline: 0.75,
  workEthic: 0,
}

/**
 * CA weights for one position: the baseline plus the position-rating weights. So everything that
 * wins games counts, but the skills the position lives on count several times more. That is the
 * budget rule from player-attributes.md: an elite center pays little CA for a poor jump shot and
 * can't be an elite ball-handler for free.
 */
function caWeightsFor(position: Position): AttributeWeights {
  const emphasis = POSITION_WEIGHTS[position]
  const entries = VISIBLE_ATTRIBUTE_KEYS.map((key) => [
    key,
    BASE_CA_WEIGHTS[key] + (emphasis[key] ?? 0),
  ])
  return Object.fromEntries(entries) as AttributeWeights
}

/** CA weights per position, built once. */
export const CA_WEIGHTS: Record<Position, AttributeWeights> = Object.fromEntries(
  POSITIONS.map((position) => [position, caWeightsFor(position)]),
) as Record<Position, AttributeWeights>

/**
 * Mapping from ability score (1–20 scale) to CA: CA = 50 + (score − SCORE_AT_CA_50) × CA_PER_POINT.
 * Calibrated so the generator's league reaches the doc's tiers with sensible attributes: a
 * league's starters (mean CA ≈ 67) average a visible rating of 10.5, the engine's reference and
 * the old generator's average team, and a GOAT (CA 100) needs nearly maxed position skills. See
 * player-roles.md "Calibration results".
 */
export const SCORE_AT_CA_50 = 9.45
export const CA_PER_POINT = 7.5

/**
 * The largest change in unrounded CA that one attribute point can cause: the heaviest CA weight's
 * share of its position's total weight, times CA_PER_POINT. It must stay below 1 so the rounded
 * CA moves at most one step per attribute point (the generator relies on this to hit targets
 * exactly; a test guards it).
 */
export const CA_MAX_STEP = Math.max(
  ...POSITIONS.map((position) => {
    const weights = Object.values(CA_WEIGHTS[position]) as number[]
    const total = weights.reduce((sum, w) => sum + w, 0)
    return (Math.max(...weights) / total) * CA_PER_POINT
  }),
)

/** The lowest and highest Current Ability. */
export const CA_MIN = 1
export const CA_MAX = 100

/** A player's ability score (1–20 scale) at one position: the CA-weighted average of attributes. */
export function abilityScore(player: PlayerProfile, position: Position): number {
  return weightedAverage(player.attributes, CA_WEIGHTS[position])
}

/** Maps an ability score onto the 1–100 CA scale (rounded, clamped). */
export function scoreToCurrentAbility(score: number): number {
  return Math.round(clamp(50 + (score - SCORE_AT_CA_50) * CA_PER_POINT, CA_MIN, CA_MAX))
}

/**
 * How strongly a poor body fit at a position discounts the ability score there (the position's
 * body factor is raised to this power). Below 1 on purpose: the body already decides which
 * positions a player can play (position ratings); CA should mostly measure skill, so a short
 * center loses some CA at C but much less than he loses in his C rating.
 */
const CA_BODY_EXPONENT = 0.5

/** A player's ability score at one position, discounted for how badly his body fits it. */
export function bodyAdjustedScore(player: PlayerProfile, position: Position): number {
  const factor = bodyFactor(player.measurables, position) ** CA_BODY_EXPONENT
  return 1 + (abilityScore(player, position) - 1) * factor
}

/**
 * A player's Current Ability: his best body-adjusted ability score over the positions his height
 * allows, on 1–100. For almost every player the best position is his primary one.
 *
 * Why the best over positions rather than "the score at the primary position": the primary
 * position can flip when one attribute changes, and taking the score at whichever position wins
 * made CA jump (+1 Finishing could move a player from C to PF and cost him 2 CA). Each position's
 * score only rises when an attribute rises (all weights are ≥ 0) and the body is fixed, so the
 * maximum is continuous and never falls: +1 to any attribute never lowers CA. That also lets the
 * generator hit any target CA exactly (see fitLevel in playerGenerator.ts).
 */
export function currentAbility(player: PlayerProfile): number {
  // Only positions his height allows (see HEIGHT_LIMITS). The body is fixed, so the set of
  // positions doesn't change with attributes and CA stays monotone.
  const eligible = POSITIONS.filter((position) => isHeightEligible(player.measurables, position))
  const best = Math.max(...eligible.map((position) => bodyAdjustedScore(player, position)))
  return scoreToCurrentAbility(best)
}

/** The named CA tiers from player-attributes.md, best first. */
export const CA_TIERS = [
  { name: 'GOAT', min: 100 },
  { name: 'Generational', min: 90 },
  { name: 'Superstar', min: 80 },
  { name: 'All-Star', min: 70 },
  { name: 'Quality starter', min: 60 },
  { name: 'Rotation player', min: 50 },
  { name: 'End of bench', min: 40 },
  { name: 'Development league', min: 30 },
  { name: 'College / amateur', min: 20 },
  { name: 'Youth prospect', min: CA_MIN },
] as const

/** A CA tier name. */
export type CaTier = (typeof CA_TIERS)[number]['name']

/** The tier a CA falls in. */
export function caTier(ca: number): CaTier {
  const tier = CA_TIERS.find((t) => ca >= t.min)
  return tier ? tier.name : 'Youth prospect'
}
