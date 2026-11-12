import type { GameState, TeamState } from './state.ts'
import { isLateInGame, leadOf } from './state.ts'
import {
  HURRY_FACTOR,
  HURRY_MIN_DEFICIT,
  HURRY_WINDOW_SECONDS,
  INTENTIONAL_FOUL_MAX_DEFICIT,
  INTENTIONAL_FOUL_MIN_DEFICIT,
  INTENTIONAL_FOUL_SECONDS,
  LAST_SHOT_BUFFER_SECONDS,
  MILK_BUFFER_SECONDS,
  MILK_FULL_LEAD,
  MILK_MAX_SHARE,
  MILK_WINDOW_SECONDS,
  THREE_HUNT_BOOST,
  THREE_HUNT_MIN_DEFICIT,
  THREE_HUNT_WINDOW_SECONDS,
} from './tuning.ts'

/**
 * Late-game score effects: how the scoreboard changes what each team does in the last minutes
 * of the final regulation period and overtime. Each team still plays at its own pace otherwise;
 * there is no shared game pace (who dictates tempo is a tactics question for later).
 */

/** True if `team` leads late and wants to run clock (and so skips fast breaks). */
export function wantsToMilkClock(game: GameState, team: TeamState): boolean {
  return isLateInGame(game, MILK_WINDOW_SECONDS) && leadOf(game, team) > 0
}

/**
 * How much of the remaining shot clock a leading team uses late, as a 0–1 share of the gap
 * between a normal action and a near shot-clock-violation action. Scales with the lead: up 1
 * they still mostly play normally, up MILK_FULL_LEAD or more they burn as much as they can.
 */
export function milkShare(game: GameState, team: TeamState): number {
  if (!wantsToMilkClock(game, team)) return 0
  return MILK_MAX_SHARE * Math.min(1, leadOf(game, team) / MILK_FULL_LEAD)
}

/** True if `team` is behind enough, late enough, that it hurries its offense. */
function wantsToHurry(game: GameState, team: TeamState): boolean {
  return isLateInGame(game, HURRY_WINDOW_SECONDS) && -leadOf(game, team) >= HURRY_MIN_DEFICIT
}

/**
 * True if the offense should hold for the last shot: tied in the final period or overtime with
 * no more game clock than shot clock left, so it can take the last shot and leave the opponent
 * no time to answer (a miss means overtime).
 */
export function holdsForLastShot(game: GameState, offense: TeamState, shotClock: number): boolean {
  return isLateInGame(game, shotClock) && leadOf(game, offense) === 0
}

/**
 * Adjusts an action's length for the score: a tied team holds for the last shot, the leading
 * team stretches it toward the end of the shot clock, a trailing team in a hurry shortens it.
 */
export function scoreAdjustedSeconds(
  game: GameState,
  offense: TeamState,
  seconds: number,
  shotClock: number,
): number {
  if (holdsForLastShot(game, offense, shotClock)) {
    return Math.max(seconds, game.clock - LAST_SHOT_BUFFER_SECONDS)
  }
  const share = milkShare(game, offense)
  if (share > 0) {
    const target = Math.max(seconds, shotClock - MILK_BUFFER_SECONDS)
    return seconds + share * (target - seconds)
  }
  return wantsToHurry(game, offense) ? seconds * HURRY_FACTOR : seconds
}

/**
 * True if the defense should foul on purpose: late, and trailing by more than it can make up
 * with normal defense in the time left (down 4–10 with about a minute to go). Stopping the clock
 * and sending the worst free-throw shooter to the line is its best chance.
 */
export function wantsIntentionalFoul(game: GameState, defense: TeamState): boolean {
  const deficit = -leadOf(game, defense)
  return (
    isLateInGame(game, INTENTIONAL_FOUL_SECONDS) &&
    deficit >= INTENTIONAL_FOUL_MIN_DEFICIT &&
    deficit <= INTENTIONAL_FOUL_MAX_DEFICIT
  )
}

/**
 * Multiplier on how often the offense chooses threes: a team down 3+ late hunts threes, more
 * urgently as the clock runs down (×1 at the start of the window up to ×(1 + BOOST) at 0:00).
 */
export function threePointHuntFactor(game: GameState, offense: TeamState): number {
  if (!isLateInGame(game, THREE_HUNT_WINDOW_SECONDS)) return 1
  if (-leadOf(game, offense) < THREE_HUNT_MIN_DEFICIT) return 1
  const urgency = 1 - game.clock / THREE_HUNT_WINDOW_SECONDS
  return 1 + THREE_HUNT_BOOST * urgency
}
