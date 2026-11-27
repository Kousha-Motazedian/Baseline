import type { Rng } from '../shared/rng.ts'
import { clamp } from '../shared/probability.ts'
import type { LeagueRules } from '../world/rules.ts'
import type { RotationCoach } from './rotationTypes.ts'
import {
  ADVANCE_CHANCE_AT_GM_1,
  ADVANCE_CHANCE_AT_GM_20,
  ADVANCE_MAX_DEFICIT,
  ADVANCE_WINDOW_SECONDS,
  END_RESERVE_AT_GM_1,
  END_RESERVE_AT_GM_20,
  FORGET_CHANCE_AT_GM_1,
  FORGET_CHANCE_AT_GM_20,
  HOPELESS_SAFETY,
  LAST_POSSESSION_CHANCE_AT_GM_1,
  LAST_POSSESSION_CHANCE_AT_GM_20,
  LAST_POSSESSION_DEFICIT,
  LAST_POSSESSION_SECONDS,
  LATE_WINDOW_SECONDS,
  LEADING_PROTECT_CHANCE,
  LEADING_PROTECT_LEAD,
  LEADING_PROTECT_SECONDS,
  MAX_WINDOW_PERIOD_SHARE,
  MID_RESERVE_AT_GM_1,
  MID_RESERVE_AT_GM_20,
  REST_AVERAGE_LINE,
  REST_CALL_CHANCE,
  REST_LOWEST_LINE_AT_GM_1,
  REST_LOWEST_LINE_AT_GM_20,
  RUN_CALL_CHANCE,
  RUN_LINE_AT_GM_1,
  RUN_LINE_AT_GM_20,
  STOP_CLOCK_CHANCE_AT_GM_1,
  STOP_CLOCK_CHANCE_AT_GM_20,
} from './timeoutTuning.ts'

/** Why a coach calls a timeout. */
export type TimeoutReason = 'stopClock' | 'advanceBall' | 'lastPossession' | 'stopRun' | 'rest'

/** Everything the coach looks at when deciding whether to call a timeout at a dead ball. */
export interface TimeoutContext {
  rules: LeagueRules
  period: number
  /** Seconds left in the period. */
  clock: number
  /** This team's margin (negative = trailing). */
  lead: number
  /** Lead in SDs of the remaining scoring swing. */
  leadSafety: number
  /** This team inbounds / has the next possession. */
  hasBall: boolean
  /** The dead ball follows an opponent score. */
  afterOpponentScore: boolean
  /** Usable right now (after every rules limit). */
  timeoutsLeft: number
  /** Left for the rest of regulation/overtime. */
  timeoutsLeftTotal: number
  /** Opponent points minus ours in the current run (>= 0). */
  opponentRun: number
  /** 0-100. */
  lowestEnergyOnCourt: number
  /** 0-100. */
  averageEnergyOnCourt: number
  coach: RotationCoach
}

/** Linear blend of a 1-20 attribute between its value at 1 and at 20. */
function byRating(rating: number, at1: number, at20: number): number {
  return at1 + (at20 - at1) * clamp((rating - 1) / 19, 0, 1)
}

/** A window length in seconds, shrunk for leagues with short periods. */
function windowSeconds(ctx: TimeoutContext, seconds: number): number {
  return Math.min(seconds, ctx.rules.periodSeconds * MAX_WINDOW_PERIOD_SHARE)
}

/** True in the final regulation period or any overtime. */
function inFinalPeriod(ctx: TimeoutContext): boolean {
  return ctx.period >= ctx.rules.periods
}

/** Share of regulation still to play (0 in the final period and overtime). */
function regulationLeft(ctx: TimeoutContext): number {
  if (inFinalPeriod(ctx)) return 0
  const left = (ctx.rules.periods - ctx.period) * ctx.rules.periodSeconds + ctx.clock
  return clamp(left / (ctx.rules.periods * ctx.rules.periodSeconds), 0, 1)
}

/**
 * How many timeouts he keeps back for the end. Why: a sharp coach holds several for the last
 * minutes (shrinking as the game goes on, but never below an end reserve in the final period);
 * a poor one barely thinks about it, which is how he ends up with none when he needs one.
 */
function reserveFor(ctx: TimeoutContext): number {
  const gm = ctx.coach.gameManagement
  const mid = byRating(gm, MID_RESERVE_AT_GM_1, MID_RESERVE_AT_GM_20) * regulationLeft(ctx)
  const end = byRating(gm, END_RESERVE_AT_GM_1, END_RESERVE_AT_GM_20)
  return Math.round(Math.max(mid, end))
}

/** Chance he forgets a late timeout; shrinks with Game Management. */
function forgetChance(ctx: TimeoutContext): number {
  return byRating(ctx.coach.gameManagement, FORGET_CHANCE_AT_GM_1, FORGET_CHANCE_AT_GM_20)
}

/** The late-game clock timeout he wants here, if any, with the chance he acts on it. */
function lateWish(ctx: TimeoutContext): { reason: TimeoutReason; chance: number } | null {
  if (!inFinalPeriod(ctx) || ctx.clock > windowSeconds(ctx, LATE_WINDOW_SECONDS)) return null
  const gm = ctx.coach.gameManagement
  if (ctx.lead > 0) return leadingWish(ctx)
  if (ctx.leadSafety < HOPELESS_SAFETY) return null
  const chance = (a: number, b: number): number => byRating(gm, a, b)
  const closeEnough = ctx.lead >= -LAST_POSSESSION_DEFICIT
  if (ctx.hasBall && closeEnough && ctx.clock <= windowSeconds(ctx, LAST_POSSESSION_SECONDS)) {
    return {
      reason: 'lastPossession',
      chance: chance(LAST_POSSESSION_CHANCE_AT_GM_1, LAST_POSSESSION_CHANCE_AT_GM_20),
    }
  }
  if (ctx.lead < 0 && ctx.afterOpponentScore) {
    return {
      reason: 'stopClock',
      chance: chance(STOP_CLOCK_CHANCE_AT_GM_1, STOP_CLOCK_CHANCE_AT_GM_20),
    }
  }
  const advanceOk =
    ctx.hasBall &&
    ctx.clock <= windowSeconds(ctx, ADVANCE_WINDOW_SECONDS) &&
    ctx.lead >= -ADVANCE_MAX_DEFICIT
  if (advanceOk) {
    return {
      reason: 'advanceBall',
      chance: chance(ADVANCE_CHANCE_AT_GM_1, ADVANCE_CHANCE_AT_GM_20),
    }
  }
  return null
}

/** A leading team rarely calls one: only to protect a small lead from a turnover at the very end. */
function leadingWish(ctx: TimeoutContext): { reason: TimeoutReason; chance: number } | null {
  const protect =
    ctx.hasBall &&
    ctx.lead <= LEADING_PROTECT_LEAD &&
    ctx.clock <= windowSeconds(ctx, LEADING_PROTECT_SECONDS)
  return protect ? { reason: 'advanceBall', chance: LEADING_PROTECT_CHANCE } : null
}

/** The run or rest timeout he wants here, if any, with the chance he acts on it. */
function pauseWish(ctx: TimeoutContext): { reason: TimeoutReason; chance: number } | null {
  const gm = ctx.coach.gameManagement
  const runLine = byRating(gm, RUN_LINE_AT_GM_1, RUN_LINE_AT_GM_20)
  if (ctx.afterOpponentScore && ctx.opponentRun >= runLine) {
    return { reason: 'stopRun', chance: RUN_CALL_CHANCE }
  }
  const lowLine = byRating(gm, REST_LOWEST_LINE_AT_GM_1, REST_LOWEST_LINE_AT_GM_20)
  const tired = ctx.lowestEnergyOnCourt < lowLine || ctx.averageEnergyOnCourt < REST_AVERAGE_LINE
  return tired ? { reason: 'rest', chance: REST_CALL_CHANCE } : null
}

/**
 * Decides whether the coach calls a timeout at this dead ball, and why. Always draws exactly two
 * random numbers (one for forgetting, one for acting) so the RNG stream does not depend on the
 * situation. Clock timeouts may use every timeout he has; run/rest ones only spare timeouts.
 */
export function decideTimeout(ctx: TimeoutContext, rng: Rng): TimeoutReason | null {
  const forgot = rng.next() < forgetChance(ctx)
  const roll = rng.next()
  if (ctx.timeoutsLeft <= 0) return null
  const late = lateWish(ctx)
  // Why the forget roll only hits late moments: those are the ones a poor coach famously misses.
  if (late) return !forgot && roll < late.chance ? late.reason : null
  if (ctx.timeoutsLeftTotal <= reserveFor(ctx)) return null
  const pause = pauseWish(ctx)
  return pause && roll < pause.chance ? pause.reason : null
}
