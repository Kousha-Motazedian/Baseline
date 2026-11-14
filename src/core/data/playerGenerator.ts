import type {
  HiddenAttributes,
  Measurables,
  VisibleAttributeKey,
  VisibleAttributes,
} from '../players/attributes.ts'
import { ATTRIBUTE_MAX, ATTRIBUTE_MIN, VISIBLE_ATTRIBUTE_KEYS } from '../players/attributes.ts'
import { CA_MAX, currentAbility } from '../players/currentAbility.ts'
import type { AttributeWeights, Position } from '../players/positions.ts'
import { HEIGHT_LIMITS, POSITION_PROFILES } from '../players/positions.ts'
import type { Player } from '../players/types.ts'
import { randomNormal } from '../shared/normal.ts'
import { AVERAGE_RATING, clamp } from '../shared/probability.ts'
import type { Rng } from '../shared/rng.ts'
import { FIRST_NAMES, LAST_NAMES, NATIONALITIES } from './names.ts'

/**
 * Random player generator. A player is generated for a position (PG–C), which sets his body and
 * the *shape* of his attributes, and to a target Current Ability, which sets their *level*: the
 * shape is built first, then every attribute is shifted up or down together until the computed
 * CA hits the target (the budget rule in docs/design/player-roles.md, section 3).
 */

/** What the caller controls when generating a player. */
export interface PlayerGenerationOptions {
  id: string
  /** The position the player is built for (his computed primary position usually matches). */
  position: Position
  /** The Current Ability (1–100) the player is built to. */
  targetCa: number
}

/** Body-type template per position: mean height, how much wingspan exceeds it, and mean weight. */
interface BodyTemplate {
  heightCm: number
  heightSd: number
  wingspanExtraCm: number
  weightKg: number
}

/** Typical pro-league body types (means roughly match real modern players at each position). */
const BODY: Record<Position, BodyTemplate> = {
  PG: { heightCm: 189, heightSd: 4, wingspanExtraCm: 5, weightKg: 86 },
  SG: { heightCm: 195, heightSd: 3.5, wingspanExtraCm: 6, weightKg: 93 },
  SF: { heightCm: 201, heightSd: 3, wingspanExtraCm: 7, weightKg: 100 },
  PF: { heightCm: 206, heightSd: 3, wingspanExtraCm: 8, weightKg: 108 },
  C: { heightCm: 211, heightSd: 3.5, wingspanExtraCm: 9, weightKg: 115 },
}

/** Spread of each attribute around the player's level + position bias. */
const ATTRIBUTE_NOISE_SD = 2

/**
 * Attributes generated independently of the player's level. Neither counts toward CA (Work Ethic
 * drives development, Leadership morale), so tying them to ability would make every star a great
 * leader and a hard worker for free.
 */
const INDEPENDENT_KEYS: readonly VisibleAttributeKey[] = ['leadership', 'workEthic']
/** Spread of the independent attributes around league average. */
const INDEPENDENT_SD = 3.5

/**
 * The range searched for a player's level (rating points). Wide enough that every attribute can
 * be pushed to either end of the 1–20 scale, so any CA from 1 to 100 is reachable.
 */
const LEVEL_MIN = -15
const LEVEL_MAX = 35
/** Bisection steps when fitting the level: 50 / 2^24 is far finer than one attribute point. */
const LEVEL_SEARCH_STEPS = 24

/** Average of a bias over all 30 attributes (unlisted attributes count as 0). */
function biasMean(bias: AttributeWeights): number {
  const total = VISIBLE_ATTRIBUTE_KEYS.reduce((sum, key) => sum + (bias[key] ?? 0), 0)
  return total / VISIBLE_ATTRIBUTE_KEYS.length
}

/** Rounds and clamps a raw value onto the 1–20 attribute scale. */
function toRating(value: number): number {
  return clamp(Math.round(value), ATTRIBUTE_MIN, ATTRIBUTE_MAX)
}

/**
 * A player's attribute shape: each attribute's offset from his level (centered position bias plus
 * per-attribute noise). Level-independent attributes get an absolute value instead.
 */
export interface AttributeShape {
  offsets: Record<VisibleAttributeKey, number>
  independent: Partial<Record<VisibleAttributeKey, number>>
}

/** Draws a player's attribute shape for a position. */
export function generateShape(rng: Rng, position: Position): AttributeShape {
  const bias = POSITION_PROFILES[position]
  const center = biasMean(bias)
  const offsets = {} as Record<VisibleAttributeKey, number>
  for (const key of VISIBLE_ATTRIBUTE_KEYS) {
    offsets[key] = (bias[key] ?? 0) - center + randomNormal(rng, 0, ATTRIBUTE_NOISE_SD)
  }
  const independent: Partial<Record<VisibleAttributeKey, number>> = {}
  for (const key of INDEPENDENT_KEYS) {
    independent[key] = toRating(randomNormal(rng, AVERAGE_RATING, INDEPENDENT_SD))
  }
  return { offsets, independent }
}

/** The 30 visible attributes for a shape placed at `level` (rounded and clamped to 1–20). */
export function attributesAtLevel(shape: AttributeShape, level: number): VisibleAttributes {
  const entries = VISIBLE_ATTRIBUTE_KEYS.map((key) => [
    key,
    shape.independent[key] ?? toRating(level + shape.offsets[key]),
  ])
  return Object.fromEntries(entries) as VisibleAttributes
}

/**
 * Finds the level at which a shape's computed CA hits `targetCa`: bisection for the lowest level
 * whose CA reaches the target. Exact by design, for two reasons:
 * - CA never falls as the level rises (every attribute moves up and CA is monotone in them; see
 *   currentAbility), so bisection is valid;
 * - as the level rises, attributes tick up one point at a time, and one point moves the unrounded
 *   CA by less than 1 (see CA_MAX_STEP in currentAbility.ts), so the rounded CA never skips a
 *   value between 1 (every attribute at 1) and 100 (every attribute at 20).
 */
export function fitLevel(
  shape: AttributeShape,
  measurables: Measurables,
  targetCa: number,
): number {
  /** CA of the shape at a level. */
  const caAt = (level: number): number =>
    currentAbility({ attributes: attributesAtLevel(shape, level), measurables })
  let low = LEVEL_MIN
  let high = LEVEL_MAX
  for (let step = 0; step < LEVEL_SEARCH_STEPS; step++) {
    const mid = (low + high) / 2
    if (caAt(mid) >= targetCa) high = mid
    else low = mid
  }
  // `high` is the first level reaching the target; with no skipped values its CA equals it.
  return high
}

/** Draws attempts before falling back to clamping (each lands in range ≥ 98% of the time). */
const HEIGHT_DRAW_ATTEMPTS = 10

/**
 * A height for a position, always inside the position's hard limits (HEIGHT_LIMITS). Redraws
 * out-of-range heights instead of clamping them, so no spike of players sits exactly at a limit;
 * the clamp after a run of misses is only a safety net.
 */
function generateHeight(rng: Rng, position: Position): number {
  const body = BODY[position]
  const range = HEIGHT_LIMITS[position]
  let height = Math.round(randomNormal(rng, body.heightCm, body.heightSd))
  for (let i = 1; i < HEIGHT_DRAW_ATTEMPTS && (height < range.minCm || height > range.maxCm); i++) {
    height = Math.round(randomNormal(rng, body.heightCm, body.heightSd))
  }
  return clamp(height, range.minCm, range.maxCm)
}

/** Generates height, wingspan, weight and biographical facts for a position. */
export function generateMeasurables(rng: Rng, position: Position): Measurables {
  const body = BODY[position]
  const heightCm = generateHeight(rng, position)
  // Wingspan and weight track height (taller players are longer and heavier) plus their own noise.
  const wingspanCm = Math.round(heightCm + randomNormal(rng, body.wingspanExtraCm, 4))
  const weightKg = Math.round(
    body.weightKg + (heightCm - body.heightCm) * 1.1 + randomNormal(rng, 0, 5),
  )
  return {
    heightCm,
    wingspanCm,
    weightKg,
    age: Math.round(clamp(randomNormal(rng, 26.5, 4), 19, 37)),
    // Roughly 1 in 8 players is left-handed, a bit above the general population.
    dominantHand: rng.chance(0.12) ? 'left' : 'right',
    nationality: rng.pick(NATIONALITIES),
  }
}

/** Generates a position's attributes at a target CA, with the body they are judged against. */
export function generateAttributes(
  rng: Rng,
  position: Position,
  targetCa: number,
  measurables: Measurables,
): VisibleAttributes {
  const shape = generateShape(rng, position)
  return attributesAtLevel(shape, fitLevel(shape, measurables, targetCa))
}

/** A 1–20 hidden personality/consistency rating, centered on average. */
function hiddenRating(rng: Rng): number {
  return toRating(randomNormal(rng, AVERAGE_RATING, 3.5))
}

/** Potential: Current Ability plus random headroom that is larger for younger players. */
export function generatePotential(rng: Rng, currentAbilityValue: number, age: number): number {
  // Young players can still grow a lot; veterans (27+) are at or near their ceiling.
  const headroom = Math.max(0, (27 - age) * 3)
  const potential = currentAbilityValue + rng.next() * headroom
  return Math.round(clamp(potential, currentAbilityValue, CA_MAX))
}

/** Generates hidden attributes; CA is computed from the attributes, never rolled. */
export function generateHidden(
  rng: Rng,
  currentAbilityValue: number,
  age: number,
): HiddenAttributes {
  return {
    currentAbility: currentAbilityValue,
    potential: generatePotential(rng, currentAbilityValue, age),
    consistency: hiddenRating(rng),
    bigGames: hiddenRating(rng),
    injuryProneness: hiddenRating(rng),
    professionalism: hiddenRating(rng),
    ambition: hiddenRating(rng),
    loyalty: hiddenRating(rng),
    temperament: hiddenRating(rng),
    adaptability: hiddenRating(rng),
  }
}

/** Generates a complete random player for a position, built to a target Current Ability. */
export function generatePlayer(rng: Rng, options: PlayerGenerationOptions): Player {
  const measurables = generateMeasurables(rng, options.position)
  const attributes = generateAttributes(rng, options.position, options.targetCa, measurables)
  return {
    id: options.id,
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
    measurables,
    attributes,
    hidden: generateHidden(rng, currentAbility({ attributes, measurables }), measurables.age),
  }
}
