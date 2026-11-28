// TEMPORARY STUB owned by the tactics developer; replaced at merge.
import type { Rng } from '../shared/rng.ts'
import type { LeagueRules } from '../world/rules.ts'
import type { RotationCoach } from './rotationTypes.ts'

/** Why a coach calls a timeout. */
export type TimeoutReason = 'stopClock' | 'advanceBall' | 'lastPossession' | 'stopRun' | 'rest'

/** Everything the timeout decision may look at (one team's view, at a dead ball). */
export interface TimeoutContext {
  rules: LeagueRules
  period: number
  clock: number
  lead: number
  leadSafety: number
  hasBall: boolean
  afterOpponentScore: boolean
  timeoutsLeft: number
  timeoutsLeftTotal: number
  opponentRun: number
  lowestEnergyOnCourt: number
  averageEnergyOnCourt: number
  coach: RotationCoach
}

/** Stub decision: late-game clock rules, run stoppers and some rest; keeps two for the end. */
export function decideTimeout(ctx: TimeoutContext, rng: Rng): TimeoutReason | null {
  if (ctx.timeoutsLeft <= 0) return null
  const finalPeriod = ctx.period >= ctx.rules.periods
  const late = finalPeriod && ctx.clock <= 120
  if (late && ctx.hasBall && ctx.lead < 0 && ctx.afterOpponentScore) return 'stopClock'
  if (late && ctx.hasBall && Math.abs(ctx.lead) <= 6 && rng.chance(0.3)) return 'advanceBall'
  if (finalPeriod || ctx.timeoutsLeftTotal <= 2) return null
  if (ctx.opponentRun >= 8) return 'stopRun'
  if (ctx.hasBall && ctx.lowestEnergyOnCourt < 45 && rng.chance(0.2)) return 'rest'
  return ctx.hasBall && rng.chance(0.012) ? 'rest' : null
}
