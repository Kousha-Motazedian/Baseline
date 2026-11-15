import { FIRST_NAMES, LAST_NAMES } from '../data/names.ts'
import { ATTRIBUTE_MAX, ATTRIBUTE_MIN } from '../players/attributes.ts'
import { randomNormal } from '../shared/normal.ts'
import { AVERAGE_RATING, clamp } from '../shared/probability.ts'
import type { Rng } from '../shared/rng.ts'
import type { SystemArchetype } from '../tactics/system.ts'
import { generateSystem, SYSTEM_ARCHETYPES } from '../tactics/system.ts'
import type { CoachAttributes, CoachHidden, HeadCoach } from './types.ts'

/**
 * Random head-coach generator. Like players, a coach is built around one overall level (his
 * "quality", on the 1–20 attribute scale): every attribute is drawn around it, so good coaches are
 * good across the board, while per-attribute noise and an archetype lean give each one real
 * strengths and weaknesses. Reputation follows quality loosely; it never feeds the simulation.
 */

/** The ten coach attributes, in display order. */
export const COACH_ATTRIBUTE_KEYS = [
  'offensiveCoaching',
  'defensiveCoaching',
  'tacticalKnowledge',
  'gameManagement',
  'rotationManagement',
  'playerEvaluation',
  'motivation',
  'playerDevelopment',
  'discipline',
  'worksWithYouth',
] as const satisfies readonly (keyof CoachAttributes)[]

/** One coach attribute's key. */
export type CoachAttributeKey = (typeof COACH_ATTRIBUTE_KEYS)[number]

/** What the caller controls when generating a coach. */
export interface CoachGenerationOptions {
  id: string
  /** Overall level on the 1–20 scale; drawn from the league-wide spread if omitted. */
  quality?: number
}

/** League-wide spread of coach quality: centered on an average rating, like players' attributes. */
export const COACH_QUALITY_MEAN = AVERAGE_RATING
const COACH_QUALITY_SD = 2.5
/** Generated qualities are kept inside this band so nobody is all 1s or all 20s. */
const QUALITY_MIN = 4
const QUALITY_MAX = 17

/**
 * Spread of each attribute around the coach's quality. Wider than players' (2): coaching skills
 * are more independent of each other than athletic and skill ratings, and a few points of spread
 * is what makes a coach a "defensive guru" or a "great motivator".
 */
const ATTRIBUTE_NOISE_SD = 2.5

/** Age range for head coaches and the typical age. */
const AGE_MIN = 35
const AGE_MAX = 70
const AGE_MEAN = 52
const AGE_SD = 8

/**
 * Reputation (1–100) model. 50 is an average coach; each quality point is worth 6 reputation, so
 * the best coaches (quality ~17) sit near 90. The noise is wide on purpose: reputation is what the
 * league *thinks*, so overrated and underrated coaches must exist for good evaluation to pay off.
 */
const REPUTATION_BASE = 50
const REPUTATION_PER_QUALITY = 6
const REPUTATION_NOISE_SD = 10
/** Older coaches are better known: reputation per year of age away from the typical age. */
const REPUTATION_PER_YEAR = 0.3
/** Reputation scale bounds (see CoachHidden). */
const REPUTATION_MIN = 1
export const REPUTATION_MAX = 100

/** Adaptability is a personality trait, drawn independently of quality around the average. */
const ADAPTABILITY_SD = 3.5

/**
 * Attribute leans per archetype (rating points before centering). A coach's identity shows in his
 * strengths: a defensive disciplinarian is better at defense and discipline than his overall level
 * suggests. Leans are centered (see centeredLean) so they change the shape, not the overall level.
 */
const ARCHETYPE_LEANS: Record<SystemArchetype, Partial<Record<CoachAttributeKey, number>>> = {
  paceAndSpace: { offensiveCoaching: 2, playerDevelopment: 1, worksWithYouth: 1, discipline: -1 },
  gritAndGrind: { defensiveCoaching: 2, discipline: 1, motivation: 1, offensiveCoaching: -1 },
  motionOffense: { offensiveCoaching: 2, tacticalKnowledge: 1, playerDevelopment: 1 },
  starDriven: { gameManagement: 1, rotationManagement: 1, worksWithYouth: -1 },
  defensiveDisciplinarian: { defensiveCoaching: 2, discipline: 2, offensiveCoaching: -1 },
  smallBall: { tacticalKnowledge: 2, offensiveCoaching: 1, worksWithYouth: 1 },
}

/** Rounds and clamps a raw value onto the 1–20 attribute scale. */
function toRating(value: number): number {
  return clamp(Math.round(value), ATTRIBUTE_MIN, ATTRIBUTE_MAX)
}

/** An archetype's lean on one attribute, minus the mean lean, so leans don't shift the level. */
function centeredLean(archetype: SystemArchetype, key: CoachAttributeKey): number {
  const leans = ARCHETYPE_LEANS[archetype]
  const total = COACH_ATTRIBUTE_KEYS.reduce((sum, k) => sum + (leans[k] ?? 0), 0)
  return (leans[key] ?? 0) - total / COACH_ATTRIBUTE_KEYS.length
}

/** Draws a coach's overall quality from the league-wide spread. */
export function drawCoachQuality(rng: Rng, mean: number = COACH_QUALITY_MEAN): number {
  return clamp(randomNormal(rng, mean, COACH_QUALITY_SD), QUALITY_MIN, QUALITY_MAX)
}

/** Draws the ten attributes around a quality level, shaped by the archetype's leans. */
export function generateCoachAttributes(
  rng: Rng,
  quality: number,
  archetype: SystemArchetype,
): CoachAttributes {
  const entries = COACH_ATTRIBUTE_KEYS.map((key) => [
    key,
    toRating(quality + centeredLean(archetype, key) + randomNormal(rng, 0, ATTRIBUTE_NOISE_SD)),
  ])
  return Object.fromEntries(entries) as CoachAttributes
}

/** A coach's reputation: his quality as the league perceives it, plus fame from years around. */
export function generateReputation(rng: Rng, quality: number, age: number): number {
  const fromQuality = REPUTATION_BASE + (quality - COACH_QUALITY_MEAN) * REPUTATION_PER_QUALITY
  const fromAge = (age - AGE_MEAN) * REPUTATION_PER_YEAR
  const raw = fromQuality + fromAge + randomNormal(rng, 0, REPUTATION_NOISE_SD)
  return clamp(Math.round(raw), REPUTATION_MIN, REPUTATION_MAX)
}

/** Generates the hidden attributes: reputation (tied to quality) and adaptability (independent). */
export function generateCoachHidden(rng: Rng, quality: number, age: number): CoachHidden {
  return {
    reputation: generateReputation(rng, quality, age),
    adaptability: toRating(randomNormal(rng, AVERAGE_RATING, ADAPTABILITY_SD)),
  }
}

/** A head coach's age, inside the 35–70 band. */
function generateAge(rng: Rng): number {
  return Math.round(clamp(randomNormal(rng, AGE_MEAN, AGE_SD), AGE_MIN, AGE_MAX))
}

/** Generates a complete, unemployed head coach (contract null). */
export function generateCoach(rng: Rng, options: CoachGenerationOptions): HeadCoach {
  const quality = options.quality ?? drawCoachQuality(rng)
  const age = generateAge(rng)
  const archetype = rng.pick(SYSTEM_ARCHETYPES)
  return {
    id: options.id,
    firstName: rng.pick(FIRST_NAMES),
    lastName: rng.pick(LAST_NAMES),
    age,
    attributes: generateCoachAttributes(rng, quality, archetype),
    hidden: generateCoachHidden(rng, quality, age),
    archetype,
    preferredSystem: generateSystem(rng, archetype),
    contract: null,
  }
}

/**
 * A simple quality estimate: the mean of the ten attributes. Used by AI hiring as a tie-break
 * after reputation; it is not a sim input (the engine reads individual attributes).
 */
export function coachQuality(coach: HeadCoach): number {
  const total = COACH_ATTRIBUTE_KEYS.reduce((sum, key) => sum + coach.attributes[key], 0)
  return total / COACH_ATTRIBUTE_KEYS.length
}
