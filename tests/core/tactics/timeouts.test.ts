import { describe, expect, it } from 'vitest'
import { createRng } from '../../../src/core/shared/rng.ts'
import { decideTimeout } from '../../../src/core/tactics/timeouts.ts'
import type { TimeoutContext } from '../../../src/core/tactics/timeouts.ts'
import { PRO_RULES } from '../../../src/core/world/rules.ts'

/** A quiet mid-game dead ball with a neutral coach; tests override what they need. */
function ctx(over: Partial<TimeoutContext> = {}): TimeoutContext {
  return {
    rules: PRO_RULES,
    period: 2,
    clock: 400,
    lead: 0,
    leadSafety: 0,
    hasBall: true,
    afterOpponentScore: false,
    timeoutsLeft: 4,
    timeoutsLeftTotal: 7,
    opponentRun: 0,
    lowestEnergyOnCourt: 80,
    averageEnergyOnCourt: 85,
    coach: { rotationManagement: 10.5, gameManagement: 10.5 },
    ...over,
  }
}

/** Share of many seeded calls that return the given reason (or any call when omitted). */
function rate(c: TimeoutContext, reason?: string): number {
  let hits = 0
  const n = 2000
  for (let i = 0; i < n; i++) {
    const r = decideTimeout(c, createRng(i + 1))
    if (reason === undefined ? r !== null : r === reason) hits++
  }
  return hits / n
}

const gm = (g: number): TimeoutContext['coach'] => ({ rotationManagement: 10.5, gameManagement: g })
const LATE = { period: 4, clock: 90 }

describe('decideTimeout', () => {
  it('never calls one with none left', () => {
    const c = ctx({ ...LATE, lead: -3, afterOpponentScore: true, timeoutsLeft: 0 })
    expect(rate(c)).toBe(0)
  })

  it('trailing late after an opponent score stops the clock', () => {
    const c = ctx({ ...LATE, lead: -4, leadSafety: -0.5, afterOpponentScore: true, coach: gm(18) })
    expect(rate(c, 'stopClock')).toBeGreaterThan(0.8)
  })

  it('advances the ball in the last two minutes with the ball', () => {
    const c = ctx({ period: 4, clock: 60, lead: -2, leadSafety: -0.3, coach: gm(18) })
    expect(rate(c, 'advanceBall')).toBeGreaterThan(0.3)
  })

  it('calls for the last possession of a close game', () => {
    const c = ctx({ period: 4, clock: 15, lead: -2, leadSafety: -0.3, coach: gm(18) })
    expect(rate(c, 'lastPossession')).toBeGreaterThan(0.8)
  })

  it('a leading team rarely calls one', () => {
    const c = ctx({ ...LATE, lead: 6, leadSafety: 1.5, afterOpponentScore: true })
    expect(rate(c)).toBeLessThan(0.05)
  })

  it('keeps a reserve early instead of burning the last ones', () => {
    const c = ctx({
      period: 1,
      clock: 300,
      opponentRun: 10,
      afterOpponentScore: true,
      timeoutsLeftTotal: 2,
    })
    expect(rate(c)).toBe(0)
    expect(rate({ ...c, timeoutsLeftTotal: 7 })).toBeGreaterThan(0.5)
  })

  it('calls a rest timeout for tired players when he can spare one', () => {
    const c = ctx({ lowestEnergyOnCourt: 20, averageEnergyOnCourt: 40, period: 3, clock: 500 })
    expect(rate(c, 'rest')).toBeGreaterThan(0.2)
  })

  it('low Game Management burns timeouts early and misses late ones more', () => {
    const early = ctx({
      period: 1,
      clock: 300,
      opponentRun: 7,
      afterOpponentScore: true,
      timeoutsLeftTotal: 3,
    })
    expect(rate({ ...early, coach: gm(2) })).toBeGreaterThan(rate({ ...early, coach: gm(19) }))
    const late = ctx({ ...LATE, lead: -4, leadSafety: -0.5, afterOpponentScore: true })
    expect(rate({ ...late, coach: gm(2) })).toBeLessThan(rate({ ...late, coach: gm(19) }))
  })

  it('is deterministic for a seed', () => {
    const c = ctx({ ...LATE, lead: -4, afterOpponentScore: true })
    expect(decideTimeout(c, createRng(7))).toBe(decideTimeout(c, createRng(7)))
  })
})
