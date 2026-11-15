import type { Rng } from '../shared/rng.ts'

/**
 * Team systems: a coach's tactical settings, one choice per setting (docs/design/coaches.md,
 * section 2). The coach's preferred system is the team's default tactics; the GM can override it.
 *
 * Scope of the first implementation (user-approved): there is no defensive scheme or pick-and-roll
 * coverage setting yet (no zone, no switching, no drop/hedge/blitz): every team plays man-to-man.
 * The rotation settings (rotationDepth, starterMinutes) are stored and generated, but have NO
 * engine effect yet; rotations are the next step.
 */

export type Pace = 'slow' | 'balanced' | 'fast'
export type ShotProfile = 'insideOut' | 'balanced' | 'threeHeavy'
export type BallMovement = 'isolation' | 'balanced' | 'motion'
export type PrimaryAction = 'pickAndRoll' | 'postUps' | 'offBall' | 'driveAndKick'
export type Transition = 'getBack' | 'balanced' | 'push'
export type OffensiveRebounding = 'getBack' | 'balanced' | 'crash'
export type DefensivePressure = 'conservative' | 'balanced' | 'aggressive'
export type HelpPriority = 'protectPaint' | 'balanced' | 'runShooters'
export type RotationDepth = 'tight' | 'normal' | 'deep'
export type StarterMinutes = 'rideStarters' | 'balanced' | 'share'

/** A team's tactical system: one choice per setting. */
export interface TeamSystem {
  pace: Pace
  shotProfile: ShotProfile
  ballMovement: BallMovement
  primaryAction: PrimaryAction
  transition: Transition
  offensiveRebounding: OffensiveRebounding
  defensivePressure: DefensivePressure
  helpPriority: HelpPriority
  /** Stored only: no engine effect until rotations exist. */
  rotationDepth: RotationDepth
  /** Stored only: no engine effect until rotations exist. */
  starterMinutes: StarterMinutes
}

/** One setting of a system. */
export type SystemSetting = keyof TeamSystem

/**
 * Every setting's options. The three-way settings are listed in order (one extreme, the middle,
 * the other extreme), so "one step" from an option is its neighbour; primary action has no order.
 */
export const SETTING_OPTIONS: { readonly [K in SystemSetting]: readonly TeamSystem[K][] } = {
  pace: ['slow', 'balanced', 'fast'],
  shotProfile: ['insideOut', 'balanced', 'threeHeavy'],
  ballMovement: ['isolation', 'balanced', 'motion'],
  primaryAction: ['pickAndRoll', 'postUps', 'offBall', 'driveAndKick'],
  transition: ['getBack', 'balanced', 'push'],
  offensiveRebounding: ['getBack', 'balanced', 'crash'],
  defensivePressure: ['conservative', 'balanced', 'aggressive'],
  helpPriority: ['protectPaint', 'balanced', 'runShooters'],
  rotationDepth: ['tight', 'normal', 'deep'],
  starterMinutes: ['rideStarters', 'balanced', 'share'],
}

/** Every setting name, in display order (offense, defense, rotation). */
export const SYSTEM_SETTINGS = Object.keys(SETTING_OPTIONS) as SystemSetting[]

/** Settings that shape the offense (they feed the offensive execution and fit). */
export const OFFENSIVE_SETTINGS: readonly SystemSetting[] = [
  'pace',
  'shotProfile',
  'ballMovement',
  'primaryAction',
  'transition',
  'offensiveRebounding',
]

/** Settings that shape the defense (they feed the defensive execution and fit). */
export const DEFENSIVE_SETTINGS: readonly SystemSetting[] = ['defensivePressure', 'helpPriority']

/**
 * Every setting 'balanced' (primaryAction: 'driveAndKick'); reproduces today's engine behaviour
 * exactly. Why drive-and-kick is the neutral action: the engine's base play mix was calibrated
 * on the modern league, which already runs mostly drive-and-kick.
 */
export const BALANCED_SYSTEM: TeamSystem = {
  pace: 'balanced',
  shotProfile: 'balanced',
  ballMovement: 'balanced',
  primaryAction: 'driveAndKick',
  transition: 'balanced',
  offensiveRebounding: 'balanced',
  defensivePressure: 'balanced',
  helpPriority: 'balanced',
  rotationDepth: 'normal',
  starterMinutes: 'balanced',
}

export type SystemArchetype =
  | 'paceAndSpace'
  | 'gritAndGrind'
  | 'motionOffense'
  | 'starDriven'
  | 'defensiveDisciplinarian'
  | 'smallBall'

/** Every system archetype. */
export const SYSTEM_ARCHETYPES: readonly SystemArchetype[] = [
  'paceAndSpace',
  'gritAndGrind',
  'motionOffense',
  'starDriven',
  'defensiveDisciplinarian',
  'smallBall',
]

/**
 * Each archetype's core settings. Each is a coherent identity, so the league gets a mix of styles:
 * - Pace and Space: run, spread the floor and fire threes off drive-and-kick and ball movement.
 * - Grit and Grind: slow it down, pound the ball inside, crash the glass and wall off the paint.
 * - Motion Offense: cuts, screens and the extra pass; a deep bench that shares minutes.
 * - Star-Driven: give the ball to the best player in pick-and-roll and isolation; ride the starters.
 * - Defensive Disciplinarian: grind out possessions, always get back, pressure the ball and run
 *   shooters off the line.
 * - Small-Ball: fast and switchy, threes and pick-and-roll, gamble for steals and push off them.
 */
const ARCHETYPE_SYSTEMS: Record<SystemArchetype, TeamSystem> = {
  paceAndSpace: {
    pace: 'fast',
    shotProfile: 'threeHeavy',
    ballMovement: 'motion',
    primaryAction: 'driveAndKick',
    transition: 'push',
    offensiveRebounding: 'getBack',
    defensivePressure: 'balanced',
    helpPriority: 'balanced',
    rotationDepth: 'normal',
    starterMinutes: 'balanced',
  },
  gritAndGrind: {
    pace: 'slow',
    shotProfile: 'insideOut',
    ballMovement: 'balanced',
    primaryAction: 'postUps',
    transition: 'getBack',
    offensiveRebounding: 'crash',
    defensivePressure: 'balanced',
    helpPriority: 'protectPaint',
    rotationDepth: 'tight',
    starterMinutes: 'rideStarters',
  },
  motionOffense: {
    pace: 'balanced',
    shotProfile: 'balanced',
    ballMovement: 'motion',
    primaryAction: 'offBall',
    transition: 'balanced',
    offensiveRebounding: 'balanced',
    defensivePressure: 'balanced',
    helpPriority: 'balanced',
    rotationDepth: 'deep',
    starterMinutes: 'share',
  },
  starDriven: {
    pace: 'balanced',
    shotProfile: 'balanced',
    ballMovement: 'isolation',
    primaryAction: 'pickAndRoll',
    transition: 'balanced',
    offensiveRebounding: 'balanced',
    defensivePressure: 'balanced',
    helpPriority: 'balanced',
    rotationDepth: 'tight',
    starterMinutes: 'rideStarters',
  },
  defensiveDisciplinarian: {
    pace: 'slow',
    shotProfile: 'balanced',
    ballMovement: 'balanced',
    primaryAction: 'pickAndRoll',
    transition: 'getBack',
    offensiveRebounding: 'getBack',
    defensivePressure: 'aggressive',
    helpPriority: 'runShooters',
    rotationDepth: 'normal',
    starterMinutes: 'balanced',
  },
  smallBall: {
    pace: 'fast',
    shotProfile: 'threeHeavy',
    ballMovement: 'balanced',
    primaryAction: 'pickAndRoll',
    transition: 'push',
    offensiveRebounding: 'getBack',
    defensivePressure: 'aggressive',
    helpPriority: 'runShooters',
    rotationDepth: 'deep',
    starterMinutes: 'share',
  },
}

/**
 * Chance a generated system varies one setting from its archetype, and (given one) a second.
 * Why: coaches of one archetype shouldn't be clones, but most should be recognisably their type,
 * so variation is occasional and small (one step on one or two settings).
 */
const FIRST_VARIATION_CHANCE = 0.5
const SECOND_VARIATION_CHANCE = 0.3

/** The core (unvaried) system for an archetype. */
export function archetypeSystem(archetype: SystemArchetype): TeamSystem {
  return { ...ARCHETYPE_SYSTEMS[archetype] }
}

/**
 * A different option for one setting: a neighbouring option for the ordered three-way settings
 * (a "fast" coach may become "balanced", never "slow"), any other option for primary action.
 */
function variedOption<K extends SystemSetting>(
  rng: Rng,
  setting: K,
  current: TeamSystem[K],
): TeamSystem[K] {
  const options = SETTING_OPTIONS[setting]
  const others = options.filter((option) => option !== current)
  if (setting === 'primaryAction') return rng.pick(others)
  const index = options.indexOf(current)
  const neighbours = others.filter((option) => Math.abs(options.indexOf(option) - index) === 1)
  return rng.pick(neighbours)
}

/** A copy of a system with one randomly chosen setting (not in `skip`) moved one step. */
function varyOneSetting(
  rng: Rng,
  system: TeamSystem,
  skip: SystemSetting | undefined,
): {
  system: TeamSystem
  setting: SystemSetting
} {
  const setting = rng.pick(SYSTEM_SETTINGS.filter((s) => s !== skip))
  return { system: { ...system, [setting]: variedOption(rng, setting, system[setting]) }, setting }
}

/** A coherent system for an archetype, with some seeded variation. */
export function generateSystem(rng: Rng, archetype: SystemArchetype): TeamSystem {
  let system = archetypeSystem(archetype)
  if (!rng.chance(FIRST_VARIATION_CHANCE)) return system
  const first = varyOneSetting(rng, system, undefined)
  system = first.system
  if (rng.chance(SECOND_VARIATION_CHANCE))
    system = varyOneSetting(rng, system, first.setting).system
  return system
}

/** The settings where `system` differs from `reference` (e.g. the GM's overrides of a coach). */
export function changedSettings(system: TeamSystem, reference: TeamSystem): SystemSetting[] {
  return SYSTEM_SETTINGS.filter((setting) => system[setting] !== reference[setting])
}
