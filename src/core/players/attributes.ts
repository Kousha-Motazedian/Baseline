/**
 * Player attribute definitions. See docs/design/player-attributes.md for what each one means
 * and which systems use it.
 */

/** Keys of the 30 visible attributes, each rated 1–20. */
export const VISIBLE_ATTRIBUTE_KEYS = [
  // Scoring
  'driving',
  'finishing',
  'postScoring',
  'midRange',
  'threePoint',
  'freeThrow',
  // Playmaking
  'ballHandling',
  'passing',
  'offBallMovement',
  // Defense
  'perimeterDefense',
  'interiorDefense',
  'stealing',
  'shotBlocking',
  // Rebounding
  'offensiveRebounding',
  'defensiveRebounding',
  // Physical
  'speed',
  'quickness',
  'strength',
  'vertical',
  'stamina',
  'durability',
  // Mental
  'offensiveIq',
  'defensiveIq',
  'composure',
  'hustle',
  'teamwork',
  'leadership',
  'aggression',
  'discipline',
  'workEthic',
] as const

export type VisibleAttributeKey = (typeof VISIBLE_ATTRIBUTE_KEYS)[number]

/** A player's visible attributes, each rated 1–20. */
export type VisibleAttributes = Record<VisibleAttributeKey, number>

/** Hidden attributes. Current Ability and Potential use 1–100; the rest use 1–20. */
export interface HiddenAttributes {
  currentAbility: number
  potential: number
  consistency: number
  bigGames: number
  injuryProneness: number
  professionalism: number
  ambition: number
  loyalty: number
  temperament: number
  adaptability: number
}

/** Real-world physical measurements and biographical facts (not ratings). */
export interface Measurables {
  heightCm: number
  wingspanCm: number
  weightKg: number
  age: number
  dominantHand: 'left' | 'right'
  nationality: string
}

/**
 * Which visible attributes belong to which end of the floor. Used by balance checks (e.g. "+3 to
 * every offensive attribute") and anywhere else that needs to treat offense and defense separately.
 *
 * Decisions:
 * - Rebounding is split: Offensive Rebounding is offense, Defensive Rebounding is defense.
 * - Aggression is offense (in the engine it draws shooting fouls); Discipline is defense (it
 *   avoids committing them).
 * - Offensive IQ / Defensive IQ go to their own ends.
 * - Physical attributes (Speed, Quickness, Strength, Vertical, Stamina, Durability) and the
 *   general mental ones (Composure, Hustle, Teamwork, Leadership, Work Ethic) are SHARED: they
 *   help at both ends, so they belong to neither list.
 */
export const OFFENSIVE_ATTRIBUTE_KEYS: readonly VisibleAttributeKey[] = [
  'driving',
  'finishing',
  'postScoring',
  'midRange',
  'threePoint',
  'freeThrow',
  'ballHandling',
  'passing',
  'offBallMovement',
  'offensiveRebounding',
  'offensiveIq',
  'aggression',
]

/** Defensive attributes; see OFFENSIVE_ATTRIBUTE_KEYS for how the split was decided. */
export const DEFENSIVE_ATTRIBUTE_KEYS: readonly VisibleAttributeKey[] = [
  'perimeterDefense',
  'interiorDefense',
  'stealing',
  'shotBlocking',
  'defensiveRebounding',
  'defensiveIq',
  'discipline',
]

/** The lowest and highest values on the 1–20 visible attribute scale. */
export const ATTRIBUTE_MIN = 1
export const ATTRIBUTE_MAX = 20
