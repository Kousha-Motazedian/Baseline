/**
 * Rotations (docs/design/rotations.md): the coach's pre-game plan and in-game substitutions.
 * This module is the public contract; the logic lives in rotationPlan.ts and rotationSubs.ts.
 */
export { buildRotationPlan, rotationCoachOf } from './rotationPlan.ts'
export { chooseReplacement, decideSubstitutions } from './rotationSubs.ts'
export { NEUTRAL_ROTATION_COACH } from './rotationTypes.ts'
export type {
  PlayerGameStatus,
  RotationCoach,
  RotationOverride,
  RotationPlan,
  Substitution,
  SubstitutionContext,
} from './rotationTypes.ts'
