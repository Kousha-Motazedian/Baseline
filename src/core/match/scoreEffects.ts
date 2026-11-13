import type { GameState, TeamState } from './state.ts'
import { isClutch, isLateInGame, leadOf } from './state.ts'
import {
  CHASE_FOUL_MAX_DEFICIT,
  FOUL_UP_THREE_SECONDS,
  HURRY_FACTOR,
  HURRY_MIN_DEFICIT,
  HURRY_WINDOW_SECONDS,
  INTENTIONAL_FOUL_BASE_DEFICIT,
  INTENTIONAL_FOUL_CUTOFF_SECONDS,
  INTENTIONAL_FOUL_MIN_DEFICIT,
  INTENTIONAL_FOUL_MIN_DURATION,
  INTENTIONAL_FOUL_SECONDS,
  INTENTIONAL_FOUL_SECONDS_PER_POINT,
  INTENTIONAL_FOUL_SPREAD_SECONDS,
  KEYED_DEFENSE_EDGE,
  KEYED_DEFENSE_MARGIN,
  KEYED_DEFENSE_SECONDS,
  LAST_SHOT_BUFFER_SECONDS,
  MILK_BUFFER_SECONDS,
  MILK_FULL_LEAD,
  MILK_MAX_SHARE,
  MILK_SHOT_PENALTY,
  MILK_WINDOW_SECONDS,
  THREE_HUNT_BOOST,
  THREE_HUNT_MIN_DEFICIT,
  THREE_HUNT_WINDOW_SECONDS,
  TRAILING_SHOT_BUFFER_SECONDS,
  TYING_THREE_FACTOR,
  TYING_TWO_THREE_FACTOR,
  TYING_THREE_SECONDS,
} from './tuning.ts'

/**
 * Late-game score effects: how the scoreboard changes what each team does in the last minutes
 * of the final regulation period and overtime (plus the end-of-period last shot in every
 * period). Each team still plays at its own pace otherwise; there is no shared game pace (who
 * dictates tempo is a tactics question for later).
 */

/** Points a three-pointer is worth: the deficit a single shot can tie. */
const THREE_POINTS = 3

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

/**
 * Log-odds penalty on the shot of a team running clock: possessions that end deep in the shot
 * clock get worse looks (real late-clock shots convert ~10 points of eFG% worse). Scales with how
 * hard the team milks it. This is what makes protecting a lead a real trade-off.
 */
export function milkShotPenalty(game: GameState, offense: TeamState): number {
  return MILK_SHOT_PENALTY * milkShare(game, offense)
}

/** True if `team` is behind enough, late enough, that it hurries its offense. */
function wantsToHurry(game: GameState, team: TeamState): boolean {
  return isLateInGame(game, HURRY_WINDOW_SECONDS) && -leadOf(game, team) >= HURRY_MIN_DEFICIT
}

/**
 * True if the offense can run out the clock: it leads in the final period or overtime and has at
 * least as much shot clock as there is game clock, so it never has to shoot.
 */
export function canRunOutClock(game: GameState, offense: TeamState, shotClock: number): boolean {
  return isLateInGame(game, shotClock) && leadOf(game, offense) > 0
}

/**
 * True if the offense waits to take the last shot of the period (game clock ≤ shot clock), so
 * the opponent gets no time to answer: always in Q1–Q3, and in the final period or overtime when
 * tied (a miss means overtime). A leading team runs out the clock instead; a trailing team can't
 * afford to wait.
 */
export function holdsForLastShot(game: GameState, offense: TeamState, shotClock: number): boolean {
  if (game.clock > shotClock) return false
  return game.period < game.rules.periods || leadOf(game, offense) === 0
}

/**
 * True if a trailing team is within one shot in the final period or overtime (down 1–3): it
 * plays for the tying (or winning) basket late in the clock instead of leaving the opponent time
 * to answer.
 */
function trailsByOneShot(game: GameState, offense: TeamState): boolean {
  const deficit = -leadOf(game, offense)
  return game.period >= game.rules.periods && deficit > 0 && deficit <= THREE_POINTS
}

/**
 * Length of a set when the period is about to end (game clock ≤ shot clock), so the shot isn't
 * rushed by the buzzer:
 * - a team holding for the last shot (Q1–Q3, or tied late) shoots with LAST_SHOT_BUFFER_SECONDS
 *   left;
 * - a team down one shot late shoots with TRAILING_SHOT_BUFFER_SECONDS left: late enough that a
 *   tying basket leaves the opponent almost nothing, early enough for a rebound or a foul;
 * - anyone else plays at its normal pace but gets the shot off by the last-shot buffer.
 * Undefined when the clock isn't a factor yet, or when there isn't even time for a quick set
 * (`minSeconds`): then the action plays out to the buzzer and the shot is a rushed heave.
 */
export function endOfPeriodSeconds(
  game: GameState,
  offense: TeamState,
  seconds: number,
  shotClock: number,
  minSeconds: number,
): number | undefined {
  if (game.clock > shotClock) return undefined
  const latest = game.clock - LAST_SHOT_BUFFER_SECONDS
  if (latest < minSeconds) return undefined
  if (holdsForLastShot(game, offense, shotClock)) return latest
  if (trailsByOneShot(game, offense)) {
    return Math.max(minSeconds, game.clock - TRAILING_SHOT_BUFFER_SECONDS)
  }
  return Math.min(seconds, latest)
}

/**
 * Adjusts an action's length for the score late in the game: the leading team stretches it
 * toward the end of the shot clock, a trailing team in a hurry shortens it. (The last shot of a
 * period is handled separately by endOfPeriodSeconds.)
 */
export function scoreAdjustedSeconds(
  game: GameState,
  offense: TeamState,
  seconds: number,
  shotClock: number,
): number {
  const share = milkShare(game, offense)
  if (share > 0) {
    const target = Math.max(seconds, shotClock - MILK_BUFFER_SECONDS)
    return seconds + share * (target - seconds)
  }
  return wantsToHurry(game, offense) ? seconds * HURRY_FACTOR : seconds
}

/**
 * Why a defense fouls on purpose:
 * - `stopClock`: it trails and needs the ball back (worst free-throw shooter targeted);
 * - `denyThree`: it leads by 3 in the final seconds and fouls before the tying three goes up.
 */
export type IntentionalFoulPlan = 'stopClock' | 'denyThree'

/** The biggest deficit still worth fouling for with the current clock (shrinks to the buzzer). */
export function maxFoulingDeficit(game: GameState): number {
  return INTENTIONAL_FOUL_BASE_DEFICIT + game.clock / INTENTIONAL_FOUL_SECONDS_PER_POINT
}

/**
 * True if a trailing defense fouls to stop the clock: down 4 or more (up to maxFoulingDeficit)
 * in the last 30 s, because it needs extra possessions; or down 1–CHASE_FOUL_MAX_DEFICIT once
 * the leader could simply run out the clock (without a foul it never gets the ball back).
 */
function trailingTeamFouls(game: GameState, defense: TeamState, shotClock: number): boolean {
  const deficit = -leadOf(game, defense)
  if (deficit <= 0) return false
  const extraPossessions =
    isLateInGame(game, INTENTIONAL_FOUL_SECONDS) &&
    deficit >= INTENTIONAL_FOUL_MIN_DEFICIT &&
    deficit <= maxFoulingDeficit(game)
  const chase = isLateInGame(game, shotClock) && deficit <= CHASE_FOUL_MAX_DEFICIT
  return extraPossessions || chase
}

/**
 * True if a defense up exactly 3 fouls in the final seconds to deny the tying three: two free
 * throws can only cut it to 1. A coaching choice (FOUL_UP_THREE_SECONDS = 0 turns it off); it
 * should become a tactics setting.
 */
function deniesTyingThree(game: GameState, defense: TeamState): boolean {
  return isLateInGame(game, FOUL_UP_THREE_SECONDS) && leadOf(game, defense) === THREE_POINTS
}

/**
 * Whether (and why) the defense fouls on purpose before this action. Never with
 * INTENTIONAL_FOUL_CUTOFF_SECONDS or less left: there is no time to foul before the buzzer, and
 * every foul must use some clock so the end of the game always arrives.
 */
export function intentionalFoulPlan(
  game: GameState,
  defense: TeamState,
  shotClock: number,
): IntentionalFoulPlan | undefined {
  if (game.clock <= INTENTIONAL_FOUL_CUTOFF_SECONDS) return undefined
  if (trailingTeamFouls(game, defense, shotClock)) return 'stopClock'
  if (deniesTyingThree(game, defense)) return 'denyThree'
  return undefined
}

/** True if the defense should foul on purpose before this action (see intentionalFoulPlan). */
export function wantsIntentionalFoul(
  game: GameState,
  defense: TeamState,
  shotClock = game.rules.shotClockSeconds,
): boolean {
  return intentionalFoulPlan(game, defense, shotClock) !== undefined
}

/**
 * Seconds an intentional foul takes: quick, never under INTENTIONAL_FOUL_MIN_DURATION (so the
 * game always moves toward its end), and always within the clock left (the caller only fouls
 * with more than INTENTIONAL_FOUL_CUTOFF_SECONDS to go).
 */
export function intentionalFoulSeconds(game: GameState): number {
  const room = Math.max(0, game.clock - INTENTIONAL_FOUL_MIN_DURATION)
  const spread = Math.min(INTENTIONAL_FOUL_SPREAD_SECONDS, room)
  return Math.min(game.clock, INTENTIONAL_FOUL_MIN_DURATION + game.rng.next() * spread)
}

/**
 * True if, under the league's away-from-the-play rule, a foul off the ball now would cost one
 * free throw (by any shooter) plus possession (pro: last 2:00 of the final period and overtime).
 * Then a stop-the-clock foul has to be on the ball handler.
 */
export function awayFromPlayRuleApplies(game: GameState): boolean {
  const window = game.rules.awayFromPlayFoulWindowSeconds
  return window !== null && isLateInGame(game, window)
}

/**
 * Multiplier on how often the offense chooses threes: a team down 3+ late hunts threes, more
 * urgently as the clock runs down (×1 at the start of the window up to ×(1 + BOOST) at 0:00); in
 * the final seconds a team down exactly 3 goes for the tying three almost every time, and a team
 * down exactly 2 mostly plays for the tying two (overtime) rather than a winning three.
 */
export function threePointHuntFactor(game: GameState, offense: TeamState): number {
  const deficit = -leadOf(game, offense)
  // The final-seconds tying choice overrides general three hunting (not a max: down 2 it must be
  // able to LOWER the three weight).
  const tying = tyingShotFactor(game, deficit)
  return tying !== 1 ? tying : catchUpThreeFactor(game, deficit)
}

/** The final-seconds tie-seeking multiplier on threes (1 when it doesn't apply). */
function tyingShotFactor(game: GameState, deficit: number): number {
  if (!isLateInGame(game, TYING_THREE_SECONDS)) return 1
  if (deficit === THREE_POINTS) return TYING_THREE_FACTOR
  return deficit === 2 ? TYING_TWO_THREE_FACTOR : 1
}

/** The general late-game three hunting of a team down 3 or more (1 = none). */
function catchUpThreeFactor(game: GameState, deficit: number): number {
  if (!isLateInGame(game, THREE_HUNT_WINDOW_SECONDS)) return 1
  if (deficit < THREE_HUNT_MIN_DEFICIT) return 1
  const urgency = 1 - game.clock / THREE_HUNT_WINDOW_SECONDS
  return 1 + THREE_HUNT_BOOST * urgency
}

/**
 * Log-odds penalty (zero or positive) on a shot on the last possession of a close game: the
 * defense is keyed in on the one shot that decides it. Without it a team holding for the last
 * shot converted like on any other possession, so tied games rarely reached overtime.
 */
export function keyedDefensePenalty(game: GameState): number {
  return isClutch(game, KEYED_DEFENSE_SECONDS, KEYED_DEFENSE_MARGIN) ? KEYED_DEFENSE_EDGE : 0
}
