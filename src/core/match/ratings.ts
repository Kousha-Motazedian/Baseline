import type { VisibleAttributeKey } from '../players/attributes.ts'
import type { Player } from '../players/types.ts'
import type { PlayType } from './types.ts'

/**
 * Composite skill ratings: how the engine combines several attributes into one number
 * (still on the 1–20 scale) for a specific situation.
 */

type AttributeWeights = Partial<Record<VisibleAttributeKey, number>>

/** Weighted average of several of a player's attributes, on the 1–20 scale. */
export function blend(player: Player, weights: AttributeWeights): number {
  let total = 0
  let weightSum = 0
  for (const [key, weight] of Object.entries(weights) as [VisibleAttributeKey, number][]) {
    total += player.attributes[key] * weight
    weightSum += weight
  }
  return total / weightSum
}

/** Height relative to a 200 cm reference, in units of 15 cm (so a 215 cm center is +1). */
export function heightEdge(player: Player): number {
  return (player.measurables.heightCm - 200) / 15
}

/** Which attributes make a player good at running each play type. */
const OFFENSIVE_WEIGHTS: Record<PlayType, AttributeWeights> = {
  // Per the design doc: Driving gets to the rim, Finishing converts once there.
  drive: { driving: 0.45, finishing: 0.35, quickness: 0.2 },
  cut: { finishing: 0.5, offBallMovement: 0.3, vertical: 0.2 },
  postUp: { postScoring: 0.6, strength: 0.25, finishing: 0.15 },
  midRange: { midRange: 0.8, offensiveIq: 0.2 },
  three: { threePoint: 0.85, offensiveIq: 0.15 },
}

/** Which attributes make a defender good at stopping each play type. */
//
// Why defense leans more on shared physical/effort attributes (Quickness, Strength, Vertical,
// Hustle) than offense does: on-ball defense is mostly about staying in front, length and
// effort, while scoring is mostly skill. This is also the main lever that makes offensive
// attributes worth somewhat more than defensive ones (target ≈ 1.4 : 1, see the design doc).
const DEFENSIVE_WEIGHTS: Record<PlayType, AttributeWeights> = {
  drive: { perimeterDefense: 0.5, quickness: 0.3, defensiveIq: 0.15, hustle: 0.05 },
  // Cuts are stopped by awareness and effort more than by on-ball skill; the rim protector
  // (blended in by contest.ts) covers the finish.
  cut: { defensiveIq: 0.45, perimeterDefense: 0.2, hustle: 0.2, quickness: 0.15 },
  postUp: { interiorDefense: 0.55, strength: 0.45 },
  midRange: { perimeterDefense: 0.6, quickness: 0.2, defensiveIq: 0.1, hustle: 0.1 },
  three: { perimeterDefense: 0.6, quickness: 0.2, defensiveIq: 0.1, hustle: 0.1 },
}

/** How good a player is at the offensive skill a play type needs (1–20 scale). */
export function offensiveSkill(player: Player, playType: PlayType): number {
  return blend(player, OFFENSIVE_WEIGHTS[playType])
}

/** How good a defender is at stopping a play type (1–20 scale). */
export function defensiveSkill(defender: Player, playType: PlayType): number {
  return blend(defender, DEFENSIVE_WEIGHTS[playType])
}

/** A player's ability to protect the rim as a help defender (1–20 scale). */
export function rimProtectionSkill(player: Player): number {
  // Vertical carries a large share: rim protection is as much about length and leaping as
  // technique (height itself is applied separately, through contestHeight).
  return blend(player, { interiorDefense: 0.45, vertical: 0.3, shotBlocking: 0.25 })
}

/** The lineup's best rim protector — the player who helps on every drive and cut. */
export function bestRimProtector(lineup: readonly Player[]): Player {
  return lineup.reduce((best, p) => (rimProtectionSkill(p) > rimProtectionSkill(best) ? p : best))
}

/** How safely a player handles the ball under pressure (1–20 scale). */
export function ballSecuritySkill(player: Player): number {
  return blend(player, { ballHandling: 0.5, offensiveIq: 0.3, passing: 0.2 })
}

/** How much a defender disrupts the ball (1–20 scale). */
export function ballPressureSkill(defender: Player): number {
  // Quickness and Hustle share the load with Stealing, like the other defensive composites.
  return blend(defender, { stealing: 0.55, quickness: 0.25, defensiveIq: 0.1, hustle: 0.1 })
}

/** A player's offensive rebounding strength (1–20 scale). */
export function offensiveReboundSkill(player: Player): number {
  return blend(player, { offensiveRebounding: 0.6, vertical: 0.2, hustle: 0.2 })
}

/** A player's defensive rebounding strength (1–20 scale). */
export function defensiveReboundSkill(player: Player): number {
  return blend(player, { defensiveRebounding: 0.6, strength: 0.2, vertical: 0.2 })
}

/** A player's shot-blocking threat (1–20 scale). */
export function blockSkill(player: Player): number {
  return blend(player, { shotBlocking: 0.6, vertical: 0.25, defensiveIq: 0.15 })
}
