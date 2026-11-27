import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRng } from '../../../src/core/shared/rng.ts'
import type { Rng } from '../../../src/core/shared/rng.ts'
import * as timeouts from '../../../src/core/tactics/timeouts.ts'
import { decideTimeout } from '../../../src/core/tactics/timeouts.ts'
import type { TimeoutContext } from '../../../src/core/tactics/timeouts.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'

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

const gm = (g: number): TimeoutContext['coach'] => ({ rotationManagement: 10.5, gameManagement: g })

/** Share of seeded calls returning the given reason (any call when omitted). */
function rate(c: TimeoutContext, reason?: string, n = 3000): number {
  let hits = 0
  for (let i = 0; i < n; i++) {
    const r = decideTimeout(c, createRng(i + 1))
    if (reason === undefined ? r !== null : r === reason) hits++
  }
  return hits / n
}

describe('timeouts tester: contract', () => {
  const src = readFileSync('src/core/tactics/timeouts.ts', 'utf8')

  it('exports only decideTimeout at runtime', () => {
    expect(Object.keys(timeouts)).toEqual(['decideTimeout'])
  })

  it('has no runtime import from the match folder and only type imports of rules', () => {
    expect(src).not.toMatch(/from '\.\.\/match\//)
    expect(src).toMatch(/import type \{ LeagueRules \}/)
  })

  it('reads no timeout fields of LeagueRules, only periods and periodSeconds', () => {
    const fields = [...src.matchAll(/ctx\.rules\.(\w+)/g)].map((m) => m[1])
    expect(new Set(fields)).toEqual(new Set(['periods', 'periodSeconds']))
  })

  it('draws exactly two rng numbers per call whatever the situation', () => {
    const situations = [
      ctx(),
      ctx({ timeoutsLeft: 0 }),
      ctx({ period: 4, clock: 20, lead: -2, leadSafety: -0.2, afterOpponentScore: true }),
      ctx({ period: 4, clock: 20, lead: 2, leadSafety: 0.5 }),
      ctx({ lowestEnergyOnCourt: 5 }),
      ctx({ opponentRun: 12, afterOpponentScore: true }),
    ]
    for (const c of situations) {
      let draws = 0
      const base = createRng(7)
      const counting: Rng = {
        next: () => (draws++, base.next()),
        nextInt: (a, b) => (draws++, base.nextInt(a, b)),
        chance: (p) => (draws++, base.chance(p)),
        pick: (items) => (draws++, base.pick(items)),
      }
      decideTimeout(c, counting)
      expect(draws).toBe(2)
    }
  })
})

describe('timeouts tester: behaviour', () => {
  it('never calls with none usable, in any situation or seed', () => {
    for (let i = 1; i <= 300; i++) {
      const r = createRng(i * 31)
      const c = ctx({
        timeoutsLeft: 0,
        timeoutsLeftTotal: r.nextInt(0, 7),
        period: r.nextInt(1, 5),
        clock: r.nextInt(1, 720),
        lead: r.nextInt(-12, 12),
        leadSafety: r.next() * 4 - 2,
        hasBall: r.chance(0.5),
        afterOpponentScore: r.chance(0.5),
        opponentRun: r.nextInt(0, 14),
        lowestEnergyOnCourt: r.nextInt(0, 100),
        averageEnergyOnCourt: r.nextInt(0, 100),
        coach: gm(r.nextInt(1, 20)),
      })
      expect(decideTimeout(c, createRng(i))).toBeNull()
    }
  })

  it('does not stop the clock when the game is hopeless', () => {
    const c = ctx({
      ...{ period: 4, clock: 120 },
      lead: -22,
      leadSafety: -4,
      afterOpponentScore: true,
      coach: gm(20),
    })
    expect(rate(c)).toBe(0)
  })

  it('stopClock needs the opponent to have scored; a trailing team after its own score or a stoppage far from the end does not', () => {
    const late = { period: 4, clock: 200, lead: -5, leadSafety: -0.6, coach: gm(20) }
    expect(rate(ctx({ ...late, afterOpponentScore: true }), 'stopClock')).toBeGreaterThan(0.9)
    expect(rate(ctx({ ...late, afterOpponentScore: false, hasBall: false }))).toBe(0)
    // 8:00 left in the 4th is outside the late window.
    expect(rate(ctx({ ...late, clock: 480, afterOpponentScore: true }), 'stopClock')).toBe(0)
  })

  it('last possession beats advanceBall and stopClock when close with the ball', () => {
    const c = ctx({
      period: 4,
      clock: 15,
      lead: -2,
      leadSafety: -0.3,
      afterOpponentScore: true,
      coach: gm(20),
    })
    expect(rate(c, 'lastPossession')).toBeGreaterThan(0.9)
    expect(rate(c, 'stopClock')).toBe(0)
    // Down 5 is not "close enough" for a last-possession call.
    expect(rate({ ...c, lead: -5 }, 'lastPossession')).toBe(0)
  })

  it('advanceBall only in the last 2:00 with the ball and within 8', () => {
    const base = ctx({ period: 4, clock: 100, lead: -4, leadSafety: -0.5, coach: gm(20) })
    expect(rate(base, 'advanceBall')).toBeGreaterThan(0.4)
    expect(rate({ ...base, clock: 180 }, 'advanceBall')).toBe(0)
    expect(rate({ ...base, hasBall: false }, 'advanceBall')).toBe(0)
    expect(rate({ ...base, lead: -10 }, 'advanceBall')).toBe(0)
  })

  it('a leading team calls at most rarely, and never when well ahead', () => {
    const lead1 = ctx({ period: 4, clock: 10, lead: 1, leadSafety: 0.2, coach: gm(20) })
    expect(rate(lead1)).toBeLessThan(0.08)
    expect(rate({ ...lead1, lead: 10, leadSafety: 2 })).toBe(0)
  })

  it('keeps the reserve early and releases it late', () => {
    const stuff = { opponentRun: 12, afterOpponentScore: true, coach: gm(20) }
    expect(rate(ctx({ ...stuff, period: 1, clock: 500, timeoutsLeftTotal: 4 }))).toBe(0)
    expect(
      rate(ctx({ ...stuff, period: 1, clock: 500, timeoutsLeftTotal: 7 }), 'stopRun'),
    ).toBeGreaterThan(0.6)
    // The end reserve (3 for GM 20) still holds in the 4th before the late window.
    expect(rate(ctx({ ...stuff, period: 4, clock: 500, timeoutsLeftTotal: 3 }))).toBe(0)
    expect(rate(ctx({ ...stuff, period: 4, clock: 500, timeoutsLeftTotal: 4 }))).toBeGreaterThan(
      0.6,
    )
  })

  it('stopRun responds to a big run, more eagerly for a low Game Management coach', () => {
    const run = (g: number, pts: number) =>
      rate(ctx({ opponentRun: pts, afterOpponentScore: true, coach: gm(g) }), 'stopRun')
    expect(run(10.5, 0)).toBe(0)
    expect(run(1, 6)).toBeGreaterThan(0.6)
    expect(run(20, 6)).toBe(0)
    expect(run(20, 10)).toBeGreaterThan(0.6)
  })

  it('rests tired players, more readily for low Game Management', () => {
    const tired = (g: number) => rate(ctx({ lowestEnergyOnCourt: 35, coach: gm(g) }), 'rest')
    expect(tired(1)).toBeGreaterThan(0.35)
    expect(tired(20)).toBe(0)
    expect(
      rate(ctx({ lowestEnergyOnCourt: 30, averageEnergyOnCourt: 45, coach: gm(20) }), 'rest'),
    ).toBeGreaterThan(0.35)
  })

  it('a poor coach forgets late timeouts more than a good one, monotonically', () => {
    const c = (g: number) => ({
      ...ctx({ period: 4, clock: 200, lead: -4, leadSafety: -0.5, afterOpponentScore: true }),
      coach: gm(g),
    })
    const rates = [1, 5, 10, 15, 20].map((g) => rate(c(g), 'stopClock'))
    for (let i = 1; i < rates.length; i++)
      expect(rates[i]).toBeGreaterThanOrEqual(rates[i - 1] - 0.02)
    expect(rates[0]).toBeLessThan(rates[4] - 0.2)
  })
})

describe('timeouts tester: league rules scaling', () => {
  it('FIBA 10-minute periods still call in the last 2:00 and 28s windows', () => {
    const f = ctx({
      rules: FIBA_RULES,
      period: 4,
      clock: 100,
      lead: -4,
      leadSafety: -0.5,
      coach: gm(20),
    })
    expect(rate(f, 'advanceBall')).toBeGreaterThan(0.4)
    expect(rate({ ...f, clock: 20, lead: -2 }, 'lastPossession')).toBeGreaterThan(0.9)
  })

  it('short periods shrink every window, so a 60s period is not "late" at 40s', () => {
    const short = { ...PRO_RULES, periods: 4, periodSeconds: 60 }
    const c = ctx({
      rules: short,
      period: 4,
      clock: 40,
      lead: -4,
      leadSafety: -0.5,
      afterOpponentScore: true,
      coach: gm(20),
    })
    expect(rate(c, 'stopClock')).toBe(0)
    expect(rate({ ...c, clock: 20 }, 'stopClock')).toBeGreaterThan(0.9)
  })

  it('a two-half league treats the second period as final, and period 5 is overtime', () => {
    const halves = { ...PRO_RULES, periods: 2, periodSeconds: 1200 }
    const c = ctx({
      rules: halves,
      period: 2,
      clock: 100,
      lead: -4,
      leadSafety: -0.5,
      coach: gm(20),
    })
    expect(rate(c, 'advanceBall')).toBeGreaterThan(0.4)
    expect(rate({ ...c, period: 5, rules: PRO_RULES }, 'advanceBall')).toBeGreaterThan(0.4)
  })
})
