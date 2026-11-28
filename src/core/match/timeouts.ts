import { decideTimeout } from '../tactics/timeouts.ts'
import type { TimeoutContext, TimeoutReason } from '../tactics/timeouts.ts'
import type { LeagueRules } from '../world/rules.ts'
import { energyOf, recoverEnergy } from './fatigue.ts'
import { leadSafety } from './leadSafety.ts'
import type { GameState, TeamState } from './state.ts'
import { leadOf, log, opponentOf } from './state.ts'
import {
  ADVANCE_BALL_SECONDS_MAX,
  ADVANCE_BALL_SECONDS_MIN,
  AFTER_TIMEOUT_MAX_EDGE,
  STOP_CLOCK_SAVED_SECONDS,
  TIMEOUT_RECOVERY,
} from './tuning.ts'

/**
 * Timeout mechanics (docs/design/timeouts.md, sections 1-2): which timeouts a team has left under
 * the league's rules, and what a called timeout does. WHEN to call one is the coach's decision
 * (tactics/timeouts.ts); the engine only asks at dead balls and enforces the limits.
 */

/** When a timeout was taken. */
export interface TimeoutUse {
  period: number
  /** Seconds left in the period when it was called. */
  clock: number
}

/** What a team's timeout call leaves for the next possession. */
export interface AfterTimeout {
  /** Log-odds execution edge from the drawn-up play (the calling team only). */
  edge: number
  /** Game-clock seconds the next set of the team with the ball saves (not yet used if > 0). */
  savedSeconds: number
}

/** Timeouts a team can use right now, and in total for the rest of regulation / this overtime. */
export interface TimeoutAvailability {
  usable: number
  total: number
}

/** Number of uses matching a test. */
function countUses(used: readonly TimeoutUse[], test: (u: TimeoutUse) => boolean): number {
  return used.filter(test).length
}

/** Which regulation pool a period draws from: always 0 in game scope, the half in half scope. */
function poolOf(rules: LeagueRules, period: number): number {
  if (rules.timeouts.scope === 'game') return 0
  return period <= rules.periods / 2 ? 0 : 1
}

/** Unused regulation timeouts at the end of regulation (what an overtime may carry over). */
function regulationLeftover(rules: LeagueRules, used: readonly TimeoutUse[]): number {
  const pool = poolOf(rules, rules.periods)
  const inPool = countUses(
    used,
    (u) => u.period <= rules.periods && poolOf(rules, u.period) === pool,
  )
  return Math.max(0, (rules.timeouts.allowances[pool] ?? 0) - inPool)
}

/** Overtime: a fresh allowance per period, plus (if the rules carry them) regulation leftovers. */
function overtimeAvailability(
  rules: LeagueRules,
  used: readonly TimeoutUse[],
  period: number,
): number {
  const t = rules.timeouts
  const fresh = Math.max(0, t.overtimeAllowance - countUses(used, (u) => u.period === period))
  if (!t.overtimeCarryOver) return fresh
  // Carried timeouts are spent only after the period's own allowance: whatever an earlier
  // overtime used beyond its allowance came out of the carried pool.
  let carriedUsed = 0
  for (let p = rules.periods + 1; p <= period; p++) {
    const inPeriod = countUses(used, (u) => u.period === p)
    carriedUsed += Math.max(0, inPeriod - t.overtimeAllowance)
  }
  return fresh + Math.max(0, regulationLeftover(rules, used) - carriedUsed)
}

/**
 * Timeouts a team may use at this moment: the pool left, capped by the final-period limit and the
 * late-window limit. `total` ignores the late-window limit (it counts what is left for the rest
 * of regulation, or of the current overtime, for the coach's reserve logic).
 */
export function timeoutAvailability(
  rules: LeagueRules,
  used: readonly TimeoutUse[],
  period: number,
  clock: number,
): TimeoutAvailability {
  const t = rules.timeouts
  if (period > rules.periods) {
    const left = overtimeAvailability(rules, used, period)
    return { usable: left, total: left }
  }
  const pool = poolOf(rules, period)
  const inPool = countUses(
    used,
    (u) => u.period <= rules.periods && poolOf(rules, u.period) === pool,
  )
  let total = (t.allowances[pool] ?? 0) - inPool
  const inFinal = period === rules.periods
  if (inFinal && t.finalPeriodMax !== null) {
    total = Math.min(total, t.finalPeriodMax - countUses(used, (u) => u.period === period))
  }
  total = Math.max(0, total)
  let usable = total
  if (inFinal && t.lateMax !== null && clock <= t.lateWindowSeconds) {
    const inWindow = countUses(used, (u) => u.period === period && u.clock <= t.lateWindowSeconds)
    usable = Math.min(usable, Math.max(0, t.lateMax - inWindow))
  }
  return { usable, total }
}

/** Timeouts the team has left right now under the league's rules. */
export function timeoutsLeft(game: GameState, team: TeamState): TimeoutAvailability {
  return timeoutAvailability(game.rules, team.timeoutLog, game.period, game.clock)
}

/** Points scored in the current unanswered run against `team` (0 if it isn't being run on). */
function opponentRunOf(game: GameState, team: TeamState): number {
  return game.run.team === opponentOf(game, team) ? game.run.points : 0
}

/** Everything the coach may look at when deciding on a timeout for `team` at this dead ball. */
function timeoutContext(
  game: GameState,
  team: TeamState,
  hasBall: boolean,
  afterOpponentScore: boolean,
  availability: TimeoutAvailability,
): TimeoutContext {
  const energies = team.onCourt.map((p) => energyOf(team, p))
  const lead = leadOf(game, team)
  return {
    rules: game.rules,
    period: game.period,
    clock: game.clock,
    lead,
    leadSafety: leadSafety(game, lead),
    hasBall,
    afterOpponentScore,
    timeoutsLeft: availability.usable,
    timeoutsLeftTotal: availability.total,
    opponentRun: opponentRunOf(game, team),
    lowestEnergyOnCourt: Math.min(...energies),
    averageEnergyOnCourt: energies.reduce((s, e) => s + e, 0) / Math.max(1, energies.length),
    coach: team.coach,
  }
}

/** True if the ball is advanced to the frontcourt after a timeout now (last 2:00 of the end). */
function advancesBall(game: GameState): boolean {
  const window = game.rules.timeouts.advanceBallWindowSeconds
  return window !== null && game.period >= game.rules.periods && game.clock <= window
}

/** The drawn-up play's log-odds edge: scales linearly with Game Management (0 at 0, max at 20). */
export function afterTimeoutEdge(team: TeamState): number {
  return (AFTER_TIMEOUT_MAX_EDGE * team.coach.gameManagement) / 20
}

/**
 * Game clock a timeout saves the team with the ball. Advancing the ball (every timeout in the
 * last 2:00 of the end, whoever calls it) saves ~5 s of bringing it up. Otherwise only a caller
 * with the ball who is stopping the clock saves the inbound seconds the clock would have run.
 */
function clockSaved(game: GameState, reason: TimeoutReason, callerHasBall: boolean): number {
  if (advancesBall(game)) {
    return (
      ADVANCE_BALL_SECONDS_MIN +
      game.rng.next() * (ADVANCE_BALL_SECONDS_MAX - ADVANCE_BALL_SECONDS_MIN)
    )
  }
  const stopsClock = reason === 'stopClock' || reason === 'lastPossession'
  return stopsClock && callerHasBall ? STOP_CLOCK_SAVED_SECONDS : 0
}

/** Carries a timeout's effects to the next possession (see AfterTimeout). */
function setAfterTimeout(team: TeamState, update: Partial<AfterTimeout>): void {
  team.afterTimeout = { edge: 0, savedSeconds: 0, ...team.afterTimeout, ...update }
}

/** Takes the timeout: spends it, logs it, rests everyone and sets up the next possession. */
function callTimeout(
  game: GameState,
  caller: TeamState,
  ball: TeamState,
  reason: TimeoutReason,
): void {
  caller.timeoutLog.push({ period: game.period, clock: game.clock })
  log(game, caller, `Timeout ${caller.team.name} (${reason})`)
  // Both teams rest, on the floor and on the bench.
  recoverEnergy(game.home, TIMEOUT_RECOVERY)
  recoverEnergy(game.away, TIMEOUT_RECOVERY)
  setAfterTimeout(caller, { edge: afterTimeoutEdge(caller) })
  setAfterTimeout(ball, { savedSeconds: clockSaved(game, reason, caller === ball) })
}

/**
 * Asks the coaches for a timeout at this dead ball and applies it. The team with the ball is
 * asked first; the other team only after a score (a live ball after a rebound or turnover gives
 * only the ball's team the right). At most one timeout per dead ball, so the ball is never
 * advanced twice. Returns true if a timeout was taken.
 */
export function runTimeoutWindow(
  game: GameState,
  ball: TeamState,
  other: TeamState,
  afterScore: boolean,
): boolean {
  const askers: [TeamState, boolean][] = [[ball, true]]
  if (afterScore) askers.push([other, false])
  for (const [team, hasBall] of askers) {
    const availability = timeoutsLeft(game, team)
    if (availability.usable <= 0) continue
    const ctx = timeoutContext(game, team, hasBall, hasBall && afterScore, availability)
    const reason = decideTimeout(ctx, game.rng)
    if (reason === null) continue
    callTimeout(game, team, ball, reason)
    return true
  }
  return false
}

/** Hands the team's saved clock to its next set once (returns 0 after that). */
export function takeSavedSeconds(team: TeamState): number {
  const saved = team.afterTimeout?.savedSeconds ?? 0
  if (team.afterTimeout) team.afterTimeout.savedSeconds = 0
  return saved
}
