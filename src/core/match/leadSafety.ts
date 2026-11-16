import type { GameState } from './state.ts'
import { isOvertime } from './state.ts'
import { LEAD_SAFETY_MIN_MINUTES, LEAD_SAFETY_SD_PER_SQRT_MINUTE } from './tuning.ts'

/**
 * How safe a lead is, shared with the coaches' substitution decisions (garbage time, closing
 * lineups). It is a measure of the game, not a modifier on play.
 */

/** Seconds left in regulation (0 in overtime). */
export function regulationSecondsLeft(game: GameState): number {
  const laterPeriods = Math.max(0, game.rules.periods - game.period)
  return isOvertime(game) ? 0 : game.clock + laterPeriods * game.rules.periodSeconds
}

/**
 * How safe a lead is: the lead measured in standard deviations of the scoring swing still to
 * come. Why this form: random scoring swings grow with the square root of the time left, so a
 * 15-point lead with 4 minutes left is far safer than the same lead with 20 minutes left.
 */
export function leadSafety(game: GameState, lead: number): number {
  const minutes = Math.max(regulationSecondsLeft(game) / 60, LEAD_SAFETY_MIN_MINUTES)
  return lead / (LEAD_SAFETY_SD_PER_SQRT_MINUTE * Math.sqrt(minutes))
}
