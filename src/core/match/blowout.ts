import { smoothStep } from '../shared/probability.ts'
import type { GameState, TeamState } from './state.ts'
import { isOvertime, leadOf } from './state.ts'
import {
  BLOWOUT_FULL_LEAD,
  BLOWOUT_FULL_SAFETY,
  BLOWOUT_MAX_EASE,
  BLOWOUT_MARGIN_SD_PER_SQRT_MINUTE,
  BLOWOUT_MIN_MINUTES,
  BLOWOUT_START_LEAD,
  BLOWOUT_START_SAFETY,
} from './tuning.ts'

/**
 * STOPGAP — blowout easing. A team with a big, safe second-half lead eases off: less effort at
 * both ends, standing in for the garbage-time minutes real teams give their bench. It is what
 * keeps blowouts from snowballing and brings the final-margin spread toward real levels.
 *
 * Replace this once rotations and tactics exist: then the bench should actually play garbage
 * time (and its lower ratings do the work), and this module should be deleted. It changes effort
 * only, never pace (who sets the tempo is a tactics decision).
 */

/** Seconds left in regulation (0 in overtime). */
export function regulationSecondsLeft(game: GameState): number {
  const laterPeriods = Math.max(0, game.rules.periods - game.period)
  return isOvertime(game) ? 0 : game.clock + laterPeriods * game.rules.periodSeconds
}

/** True in the second half of regulation (overtime is always close, so never). */
function isSecondHalf(game: GameState): boolean {
  return !isOvertime(game) && game.period > game.rules.periods / 2
}

/**
 * How safe a lead is: the lead measured in standard deviations of the scoring swing still to
 * come. Why this form: random scoring swings grow with the square root of the time left, so a
 * 15-point lead with 4 minutes left is far safer than the same lead with 20 minutes left.
 */
export function leadSafety(game: GameState, lead: number): number {
  const minutes = Math.max(regulationSecondsLeft(game) / 60, BLOWOUT_MIN_MINUTES)
  return lead / (BLOWOUT_MARGIN_SD_PER_SQRT_MINUTE * Math.sqrt(minutes))
}

/**
 * The log-odds a leading team gives up by easing off (zero or negative), applied to every one of
 * its players at both ends of the floor. It ramps smoothly with both the lead's size and its
 * safety, so there is no cliff at any particular score or time.
 */
export function easeOffEdge(game: GameState, team: TeamState): number {
  const lead = leadOf(game, team)
  if (lead <= 0 || !isSecondHalf(game)) return 0
  // Both ramps must be on: a 6-point lead with a minute left is "safe" but nobody eases off in a
  // 6-point game, and a 25-point lead at the start of Q3 still gets played hard for a while.
  const size = smoothStep(BLOWOUT_START_LEAD, BLOWOUT_FULL_LEAD, lead)
  const safety = smoothStep(BLOWOUT_START_SAFETY, BLOWOUT_FULL_SAFETY, leadSafety(game, lead))
  const ease = BLOWOUT_MAX_EASE * size * safety
  // Return a clean 0 (not −0) when either ramp is off.
  return ease === 0 ? 0 : -ease
}
