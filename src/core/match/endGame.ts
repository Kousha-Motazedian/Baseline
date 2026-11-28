import { randomNormal } from '../shared/normal.ts'
import { clamp } from '../shared/probability.ts'
import type { Rng } from '../shared/rng.ts'
import type { RotationCoach } from '../tactics/rotationTypes.ts'
import {
  CHASE_FOUL_MISS_MAX,
  FOUL_DEFICIT_SPREAD,
  FOUL_UP_THREE_CHANCE_MAX,
  FOUL_UP_THREE_CHANCE_MIN,
  FOUL_WINDOW_SPREAD,
  LAST_SHOT_TIMING_SD,
  TWO_FOR_ONE_CHANCE_MAX,
  TWO_FOR_ONE_CHANCE_MIN,
} from './tuning.ts'

/**
 * The coach's end-of-game decisions, made well or badly by his Game Management (1-20). A neutral
 * coach (10.5) behaves roughly like the engine's plain late-game rules; a poor one fouls late,
 * forgets the last-seconds fouls, mistimes the last shot and rarely goes for a 2-for-1.
 */

/** Game Management as a 0-1 share of the scale: 1 -> 0, 10.5 -> 0.5, 20 -> 1. */
function gmShare(coach: RotationCoach): number {
  return clamp((coach.gameManagement - 1) / 19, 0, 1)
}

/** Skill from -1 (Game Management 1) through 0 (neutral) to +1 (20). */
function gmSkill(coach: RotationCoach): number {
  return gmShare(coach) * 2 - 1
}

/** Linear between the two ends: `min` at Game Management 1, `max` at 20. */
function byGameManagement(coach: RotationCoach, min: number, max: number): number {
  return min + (max - min) * gmShare(coach)
}

/**
 * The all-or-nothing end-game calls a coach makes (or misses) once per game. Rolled at tip-off
 * rather than every time the situation comes up, so a call is consistent through the situation
 * (a coach doesn't foul on one possession and forget on the next).
 */
export interface EndGameLapses {
  /** Fouls when up exactly 3 in the final seconds, to stop the tying three. */
  foulsUpThree: boolean
  /** Forgets to foul when down 1-3 and the leader can run out the clock (the game just ends). */
  missesChaseFoul: boolean
}

/** Rolls a coach's end-game calls for this game. Always draws two numbers (stable RNG stream). */
export function rollEndGameLapses(rng: Rng, coach: RotationCoach): EndGameLapses {
  const upThree = rng.next()
  const chase = rng.next()
  return {
    foulsUpThree:
      upThree < byGameManagement(coach, FOUL_UP_THREE_CHANCE_MIN, FOUL_UP_THREE_CHANCE_MAX),
    // Only below-neutral coaches forget: a neutral one reproduces the plain rule exactly.
    missesChaseFoul: chase < CHASE_FOUL_MISS_MAX * Math.max(0, -gmSkill(coach)),
  }
}

/**
 * Seconds left at which a trailing coach starts fouling for extra possessions (down 4+). A poor
 * coach starts too late (the window shrinks), a good one a little earlier.
 */
export function foulWindowSeconds(coach: RotationCoach, baseSeconds: number): number {
  return baseSeconds * (1 + FOUL_WINDOW_SPREAD * gmSkill(coach))
}

/**
 * Multiplier on the deficit still worth fouling for. A poor coach keeps fouling after the game is
 * gone (a bigger cap); a good one is slightly tighter than the plain rule.
 */
export function foulDeficitFactor(coach: RotationCoach): number {
  return 1 - FOUL_DEFICIT_SPREAD * gmSkill(coach) * (gmSkill(coach) < 0 ? 1 : 0.3)
}

/**
 * Error (seconds) in when a team times its last shot: positive = shoots early (leaves the
 * opponent time), negative = holds too long (a rushed heave). Zero spread from a neutral coach up.
 */
export function lastShotTimingError(rng: Rng, coach: RotationCoach): number {
  // Only below-neutral coaches err (neutral and better time it as the plain rule does).
  const sd = LAST_SHOT_TIMING_SD * Math.max(0, 1 - 2 * gmShare(coach))
  return sd === 0 ? 0 : randomNormal(rng, 0, sd)
}

/** How firmly the coach goes for the tying shot (0-1): neutral and better are fully committed. */
function tyingShare(coach: RotationCoach): number {
  return Math.min(1, gmShare(coach) * 2)
}

/** Multiplier on three-point weight down exactly 3 late: `full` for a committed coach, 1 for none. */
export function tyingThreeWeight(coach: RotationCoach, full: number): number {
  return 1 + (full - 1) * tyingShare(coach)
}

/** Chance the coach takes the 2-for-1 when it is there. */
export function twoForOneChance(coach: RotationCoach): number {
  return byGameManagement(coach, TWO_FOR_ONE_CHANCE_MIN, TWO_FOR_ONE_CHANCE_MAX)
}
