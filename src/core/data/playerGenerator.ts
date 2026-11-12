import type {
  HiddenAttributes,
  Measurables,
  VisibleAttributeKey,
  VisibleAttributes,
} from '../players/attributes.ts'
import { ATTRIBUTE_MAX, ATTRIBUTE_MIN, VISIBLE_ATTRIBUTE_KEYS } from '../players/attributes.ts'
import type { Player } from '../players/types.ts'
import { randomNormal } from '../shared/normal.ts'
import { AVERAGE_RATING, clamp } from '../shared/probability.ts'
import type { Rng } from '../shared/rng.ts'
import { FIRST_NAMES, LAST_NAMES, NATIONALITIES } from './names.ts'

/**
 * Random player generator. Players are built from an archetype (guard / wing / big), which tilts
 * their attributes and body type, around a quality level (the player's mean visible rating).
 */

/** Broad player types used by the generator. Positions themselves are not stored (see design doc). */
export type Archetype = 'guard' | 'wing' | 'big'

/** What the caller controls when generating a player. */
export interface PlayerGenerationOptions {
  id: string
  archetype: Archetype
  /** The player's intended mean visible rating on the 1–20 scale (10.5 = league average). */
  quality: number
}

type AttributeBias = Partial<Record<VisibleAttributeKey, number>>

/**
 * How each archetype deviates from its quality level, in rating points. The biases are centered
 * (their mean is subtracted) before use, so an archetype changes the *shape* of a player's
 * ratings, not their overall level: a quality-12 big and a quality-12 guard are equally good.
 */
const ARCHETYPE_BIAS: Record<Archetype, AttributeBias> = {
  // Ball handlers and shooters: quick and skilled, small and weak inside.
  guard: {
    driving: 2,
    finishing: -0.5,
    postScoring: -3.5,
    midRange: 1,
    threePoint: 2,
    freeThrow: 1.5,
    ballHandling: 3.5,
    passing: 3,
    offBallMovement: 0.5,
    perimeterDefense: 1,
    interiorDefense: -3,
    stealing: 1.5,
    shotBlocking: -3.5,
    offensiveRebounding: -3,
    defensiveRebounding: -2.5,
    speed: 2.5,
    quickness: 2.5,
    strength: -2.5,
    offensiveIq: 0.5,
  },
  // Two-way all-rounders: perimeter defense and off-ball scoring, a bit of everything.
  wing: {
    driving: 1,
    finishing: 0.5,
    postScoring: -1,
    midRange: 1,
    threePoint: 1,
    ballHandling: -0.5,
    passing: -0.5,
    offBallMovement: 1.5,
    perimeterDefense: 1.5,
    interiorDefense: -0.5,
    stealing: 1,
    shotBlocking: -0.5,
    offensiveRebounding: -0.5,
    speed: 1,
    quickness: 1,
    vertical: 1,
  },
  // Interior players: size, strength, rebounding and rim protection; poor handlers and shooters.
  big: {
    driving: -2.5,
    finishing: 2.5,
    postScoring: 3.5,
    midRange: -1,
    threePoint: -3,
    freeThrow: -2.5,
    ballHandling: -3.5,
    passing: -1.5,
    perimeterDefense: -2.5,
    interiorDefense: 3.5,
    stealing: -2,
    shotBlocking: 4,
    offensiveRebounding: 4,
    defensiveRebounding: 4,
    speed: -2.5,
    quickness: -2.5,
    strength: 3.5,
    vertical: 1,
  },
}

/** Body-type template per archetype: mean height, how much wingspan exceeds it, and mean weight. */
interface BodyTemplate {
  heightCm: number
  heightSd: number
  wingspanExtraCm: number
  weightKg: number
}

/** Typical pro-league body types (means roughly match real modern guards, wings and bigs). */
const BODY: Record<Archetype, BodyTemplate> = {
  guard: { heightCm: 191, heightSd: 4.5, wingspanExtraCm: 5, weightKg: 89 },
  wing: { heightCm: 201, heightSd: 4, wingspanExtraCm: 7, weightKg: 100 },
  big: { heightCm: 210, heightSd: 4.5, wingspanExtraCm: 9, weightKg: 113 },
}

/** Spread of one player's overall level around the requested quality (some are simply better). */
const PLAYER_QUALITY_SD = 1
/** Spread of each attribute around the player's level + archetype bias. */
const ATTRIBUTE_NOISE_SD = 2

/** Average of an archetype's biases over all 30 attributes (unlisted attributes count as 0). */
function biasMean(bias: AttributeBias): number {
  const total = VISIBLE_ATTRIBUTE_KEYS.reduce((sum, key) => sum + (bias[key] ?? 0), 0)
  return total / VISIBLE_ATTRIBUTE_KEYS.length
}

/** Rounds and clamps a raw value onto the 1–20 attribute scale. */
function toRating(value: number): number {
  return clamp(Math.round(value), ATTRIBUTE_MIN, ATTRIBUTE_MAX)
}

/** Generates the 30 visible attributes: quality + centered archetype bias + per-attribute noise. */
export function generateAttributes(
  rng: Rng,
  archetype: Archetype,
  quality: number,
): VisibleAttributes {
  const bias = ARCHETYPE_BIAS[archetype]
  const center = biasMean(bias)
  const level = randomNormal(rng, quality, PLAYER_QUALITY_SD)
  const entries = VISIBLE_ATTRIBUTE_KEYS.map((key) => {
    const mean = level + (bias[key] ?? 0) - center
    return [key, toRating(randomNormal(rng, mean, ATTRIBUTE_NOISE_SD))]
  })
  return Object.fromEntries(entries) as VisibleAttributes
}

/** Generates height, wingspan, weight and biographical facts for an archetype. */
export function generateMeasurables(rng: Rng, archetype: Archetype): Measurables {
  const body = BODY[archetype]
  const heightCm = Math.round(randomNormal(rng, body.heightCm, body.heightSd))
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

/** Mean of all 30 visible attributes. */
function meanAttribute(attributes: VisibleAttributes): number {
  const sum = VISIBLE_ATTRIBUTE_KEYS.reduce((total, key) => total + attributes[key], 0)
  return sum / VISIBLE_ATTRIBUTE_KEYS.length
}

/**
 * PLACEHOLDER Current Ability, derived from the visible attributes. The real CA budget system
 * (role-weighted attribute costs, see docs/design/player-attributes.md) isn't built yet; until it
 * is, CA is just the mean visible rating stretched onto 1–100, so a league-average (10.5) player
 * lands at 50 ("rotation player") and each rating point is worth about 5 CA.
 */
export function placeholderCurrentAbility(attributes: VisibleAttributes): number {
  return Math.round(clamp(50 + (meanAttribute(attributes) - AVERAGE_RATING) * 5.3, 1, 100))
}

/** A 1–20 hidden personality/consistency rating, centered on average. */
function hiddenRating(rng: Rng): number {
  return toRating(randomNormal(rng, AVERAGE_RATING, 3.5))
}

/** Generates hidden attributes; potential headroom is larger for younger players. */
export function generateHidden(
  rng: Rng,
  attributes: VisibleAttributes,
  age: number,
): HiddenAttributes {
  const currentAbility = placeholderCurrentAbility(attributes)
  // Young players can still grow a lot; veterans (27+) are at or near their ceiling.
  const headroom = Math.max(0, (27 - age) * 3)
  const potential = Math.round(clamp(currentAbility + rng.next() * headroom, currentAbility, 100))
  return {
    currentAbility,
    potential,
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

/** Generates a complete random player of the given archetype and quality. */
export function generatePlayer(rng: Rng, options: PlayerGenerationOptions): Player {
  const measurables = generateMeasurables(rng, options.archetype)
  const attributes = generateAttributes(rng, options.archetype, options.quality)
  return {
    id: options.id,
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
    measurables,
    attributes,
    hidden: generateHidden(rng, attributes, measurables.age),
  }
}
