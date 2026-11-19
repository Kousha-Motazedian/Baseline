import { describe, expect, it } from 'vitest'
import type { Player } from '../../../src/core/players/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import type {
  PlayerGameStatus,
  RotationPlan,
  SubstitutionContext,
} from '../../../src/core/tactics/rotation.ts'
import {
  buildRotationPlan,
  chooseReplacement,
  decideSubstitutions,
  NEUTRAL_ROTATION_COACH,
  rotationCoachOf,
} from '../../../src/core/tactics/rotation.ts'
import { isGarbageTime } from '../../../src/core/tactics/rotationSubs.ts'
import { reputationShare } from '../../../src/core/tactics/rotationValue.ts'
import { BALANCED_SYSTEM } from '../../../src/core/tactics/system.ts'
import type { TeamSystem } from '../../../src/core/tactics/system.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { makeCoach } from '../../helpers/coaching.ts'
import { makePlayer } from '../../helpers/fixtures.ts'

const HEIGHTS = [191, 191, 201, 201, 210, 191, 201, 210, 191, 201, 210, 201]

/** A 12-man roster: ratings fall with the index so the order is predictable; CA and age settable. */
function roster(opts: { ca?: (i: number) => number; age?: (i: number) => number } = {}): Player[] {
  return HEIGHTS.map((heightCm, i) => {
    const p = makePlayer({ id: `p${i}`, rating: 16 - i * 0.7, heightCm })
    p.hidden.currentAbility = opts.ca?.(i) ?? 80 - i * 4
    p.measurables.age = opts.age?.(i) ?? 27
    return p
  })
}

/** A balanced system with settings changed. */
function sys(patch: Partial<TeamSystem> = {}): TeamSystem {
  return { ...BALANCED_SYSTEM, ...patch }
}

const TOTAL = PRO_RULES.periods * PRO_RULES.periodSeconds * 5

/** Fresh statuses for a roster. */
function fresh(players: readonly Player[], patch: Record<string, Partial<PlayerGameStatus>> = {}) {
  return Object.fromEntries(
    players.map((p) => [
      p.id,
      { energy: 100, secondsPlayed: 0, personalFouls: 0, disqualified: false, ...patch[p.id] },
    ]),
  )
}

/** A substitution context with sensible defaults at the start of a game. */
function ctxOf(
  players: Player[],
  plan: RotationPlan,
  patch: Partial<SubstitutionContext> = {},
): SubstitutionContext {
  return {
    rules: PRO_RULES,
    period: 1,
    clock: PRO_RULES.periodSeconds,
    lead: 0,
    leadSafety: 0,
    roster: players,
    onCourt: plan.starters,
    status: fresh(players),
    plan,
    coach: NEUTRAL_ROTATION_COACH,
    ...patch,
  }
}

describe('Player Evaluation blend', () => {
  it('is 70% reputation at 1 and 10% at 20, linear between', () => {
    expect(reputationShare(1)).toBeCloseTo(0.7)
    expect(reputationShare(20)).toBeCloseTo(0.1)
    expect(reputationShare(10.5)).toBeCloseTo(0.4)
  })

  it('a low-PE coach starts a famous weak player; a high-PE coach does not', () => {
    // p11 is the worst by ratings but has by far the best reputation.
    const players = roster({ ca: (i) => (i === 11 ? 100 : 40) })
    const low = buildRotationPlan(
      players,
      makeCoach({ attributes: { playerEvaluation: 1 } }),
      sys(),
    )
    const high = buildRotationPlan(
      players,
      makeCoach({ attributes: { playerEvaluation: 20 } }),
      sys(),
    )
    expect(low.order.indexOf('p11')).toBeLessThan(high.order.indexOf('p11'))
    expect(high.order.indexOf('p11')).toBeGreaterThanOrEqual(9)
  })
})

describe('Works With Youth', () => {
  it('a low-WWY coach sits a better rookie; a high one plays him', () => {
    const players = roster({ age: (i) => (i === 5 ? 19 : 28) })
    const low = buildRotationPlan(players, makeCoach({ attributes: { worksWithYouth: 1 } }), sys())
    const high = buildRotationPlan(
      players,
      makeCoach({ attributes: { worksWithYouth: 20 } }),
      sys(),
    )
    expect(low.order.indexOf('p5')).toBeGreaterThanOrEqual(high.order.indexOf('p5'))
    expect(low.targetSeconds['p5'] ?? 0).toBeLessThan(high.targetSeconds['p5'] ?? 0)
  })
})

describe('plan targets', () => {
  it('sum to the game total for every depth and starter-minutes setting', () => {
    const players = roster()
    for (const rotationDepth of ['tight', 'normal', 'deep'] as const) {
      for (const starterMinutes of ['rideStarters', 'balanced', 'share'] as const) {
        const plan = buildRotationPlan(players, makeCoach(), sys({ rotationDepth, starterMinutes }))
        const sum = Object.values(plan.targetSeconds).reduce((a, b) => a + b, 0)
        expect(sum).toBeCloseTo(TOTAL, 3)
      }
    }
  })

  it('uses the league rules for game length (FIBA is 40 minutes)', () => {
    const plan = buildRotationPlan(roster(), makeCoach(), sys(), undefined, FIBA_RULES)
    const sum = Object.values(plan.targetSeconds).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(FIBA_RULES.periods * FIBA_RULES.periodSeconds * 5, 3)
  })

  it('depth sets how many players get minutes', () => {
    const count = (rotationDepth: 'tight' | 'normal' | 'deep'): number =>
      Object.values(
        buildRotationPlan(roster(), makeCoach(), sys({ rotationDepth })).targetSeconds,
      ).filter((s) => s > 0).length
    expect(count('tight')).toBe(8)
    expect(count('normal')).toBe(9)
    expect(count('deep')).toBe(10)
  })

  // Plan minutes are above the realised 30-33 because garbage time and fatigue take about 4 off
  // (calibrated in rotations.md section 5), so the setting values are 37 / 34 / 31.
  it('starter minutes follow the setting', () => {
    const avg = (starterMinutes: 'rideStarters' | 'balanced' | 'share'): number => {
      const plan = buildRotationPlan(roster(), makeCoach(), sys({ starterMinutes }))
      return plan.starters.reduce((s, id) => s + (plan.targetSeconds[id] ?? 0), 0) / 5 / 60
    }
    expect(avg('rideStarters')).toBeCloseTo(37, 0)
    expect(avg('balanced')).toBeCloseTo(34, 0)
    expect(avg('share')).toBeCloseTo(31, 0)
  })

  it('orders every roster id with the starters first', () => {
    const plan = buildRotationPlan(roster(), makeCoach(), sys())
    expect([...plan.order].sort()).toEqual(
      roster()
        .map((p) => p.id)
        .sort(),
    )
    expect(plan.order.slice(0, 5)).toEqual(plan.starters)
  })

  it('works with no coach', () => {
    const plan = buildRotationPlan(roster(), undefined, sys())
    expect(plan.starters).toHaveLength(5)
    expect(rotationCoachOf(undefined)).toEqual(NEUTRAL_ROTATION_COACH)
  })
})

describe('starters and closers', () => {
  it('start a ball handler and a big even when the best players are all wings', () => {
    const players = roster()
    // Make the best five all 201 cm wings; a 191 guard and a 210 big sit lower.
    const wings = players.filter((p) => p.measurables.heightCm === 201)
    const plan = buildRotationPlan(players, makeCoach(), sys())
    const tall = plan.starters.filter(
      (id) => (players.find((p) => p.id === id)?.measurables.heightCm ?? 0) >= 208,
    )
    const short = plan.starters.filter(
      (id) => (players.find((p) => p.id === id)?.measurables.heightCm ?? 0) <= 192,
    )
    expect(wings.length).toBeGreaterThan(0)
    expect(tall.length).toBeGreaterThanOrEqual(1)
    expect(short.length).toBeGreaterThanOrEqual(1)
  })

  it('closers are five distinct roster players', () => {
    const plan = buildRotationPlan(roster(), makeCoach(), sys())
    expect(new Set(plan.closers).size).toBe(5)
  })
})

describe('GM override', () => {
  it('is used exactly, ignoring invalid ids', () => {
    const players = roster()
    const override = {
      starters: ['p11', 'p10', 'p9', 'p8', 'p7', 'nobody'],
      order: ['p6', 'p5', 'ghost'],
      targetSeconds: { p11: 2400, p10: 100, ghost: 5 },
    }
    const plan = buildRotationPlan(players, makeCoach(), sys(), override)
    expect(plan.starters).toEqual(['p11', 'p10', 'p9', 'p8', 'p7'])
    expect(plan.order.slice(0, 7)).toEqual(['p11', 'p10', 'p9', 'p8', 'p7', 'p6', 'p5'])
    expect(plan.order).toHaveLength(12)
    expect(plan.targetSeconds['p11']).toBe(2400)
    expect(plan.targetSeconds['p6']).toBe(0)
    expect(plan.targetSeconds['ghost']).toBeUndefined()
  })

  it('tops up starters from the coach when fewer than five are valid', () => {
    const plan = buildRotationPlan(roster(), makeCoach(), sys(), {
      starters: ['p11'],
      order: [],
      targetSeconds: {},
    })
    expect(plan.starters).toHaveLength(5)
    expect(plan.starters[0]).toBe('p11')
    expect(new Set(plan.starters).size).toBe(5)
  })
})

describe('foul trouble', () => {
  const players = roster()
  const plan = buildRotationPlan(players, makeCoach(), sys())
  const star = plan.starters[0] as string

  it('sits a player at the quarter threshold and brings him back later', () => {
    const rng = createRng(1)
    const inTrouble = fresh(players, { [star]: { personalFouls: 2 } })
    const sat = decideSubstitutions(ctxOf(players, plan, { status: inTrouble }), rng)
    expect(sat.some((s) => plan.starters[s.slot] === star)).toBe(true)
    // Next quarter the threshold is 3, so two fouls is fine at the start of Q2.
    const q2 = decideSubstitutions(
      ctxOf(players, plan, { period: 2, status: inTrouble }),
      createRng(1),
    )
    expect(q2.some((s) => plan.starters[s.slot] === star)).toBe(false)
    // Late in Q1 he may return: he is the best replacement again; earlier he is not.
    const slot = plan.starters.indexOf(star)
    const bench = plan.starters.map((id) => (id === star ? (plan.order[5] as string) : id))
    const lateCtx = ctxOf(players, plan, { clock: 60, status: inTrouble, onCourt: bench })
    expect(chooseReplacement(lateCtx, slot)).toBe(star)
    const earlyCtx = { ...lateCtx, clock: 600 }
    expect(chooseReplacement(earlyCtx, slot)).not.toBe(star)
  })

  it('scales the threshold for FIBA (five fouls)', () => {
    const fiba = decideSubstitutions(
      ctxOf(players, plan, {
        rules: FIBA_RULES,
        status: fresh(players, { [star]: { personalFouls: 2 } }),
      }),
      createRng(1),
    )
    expect(fiba.some((s) => plan.starters[s.slot] === star)).toBe(true)
  })

  it('plays everyone late in a close game', () => {
    const subs = decideSubstitutions(
      ctxOf(players, plan, {
        period: 4,
        clock: 90,
        status: fresh(players, { [star]: { personalFouls: 5 } }),
      }),
      createRng(1),
    )
    expect(subs.some((s) => plan.starters[s.slot] === star)).toBe(false)
  })
})

describe('garbage time', () => {
  const players = roster()
  const plan = buildRotationPlan(players, makeCoach(), sys())

  it('empties the bench for the leading team, deepest first', () => {
    const subs = decideSubstitutions(
      ctxOf(players, plan, { period: 4, clock: 400, lead: 25, leadSafety: 4 }),
      createRng(1),
    )
    expect(subs.length).toBeGreaterThanOrEqual(3)
    const deep = new Set(plan.order.slice(-7))
    expect(subs.every((s) => deep.has(s.incomingId))).toBe(true)
  })

  it('does the same for the trailing team', () => {
    const subs = decideSubstitutions(
      ctxOf(players, plan, { period: 4, clock: 400, lead: -25, leadSafety: -4 }),
      createRng(1),
    )
    expect(subs.length).toBeGreaterThanOrEqual(3)
  })

  it('does not happen in a close game', () => {
    const subs = decideSubstitutions(
      ctxOf(players, plan, { period: 4, clock: 400, lead: 5, leadSafety: 0.5 }),
      createRng(1),
    )
    expect(subs).toHaveLength(0)
  })

  it('keeps players the plan gives no minutes out until the game is decided', () => {
    const idle = new Set(plan.order.filter((id) => (plan.targetSeconds[id] ?? 0) <= 0))
    expect(idle.size).toBeGreaterThan(0)
    const safe = decideSubstitutions(
      ctxOf(players, plan, { period: 4, clock: 400, lead: 18, leadSafety: 3 }),
      createRng(1),
    )
    expect(safe.length).toBeGreaterThanOrEqual(3)
    expect(safe.some((s) => idle.has(s.incomingId))).toBe(false)
    const over = decideSubstitutions(
      ctxOf(players, plan, { period: 4, clock: 100, lead: 25, leadSafety: 6 }),
      createRng(1),
    )
    expect(over.some((s) => idle.has(s.incomingId))).toBe(true)
  })

  it('is mostly a fourth-quarter thing: the third quarter needs a much bigger lead', () => {
    const q3 = (lead: number, safety: number) =>
      decideSubstitutions(
        ctxOf(players, plan, { period: 3, clock: 300, lead, leadSafety: safety }),
        createRng(1),
      )
    expect(q3(12, 2.2)).toHaveLength(0)
    expect(q3(25, 4).length).toBeGreaterThanOrEqual(3)
  })

  it('has hysteresis: with the bench already in, a lead sliding below the entry lead stays garbage', () => {
    // A lead of 8 with safety 1.4 is under the entry thresholds (10 and 1.6 at average Game
    // Management) but over 50% of them.
    const hovering = { period: 4, clock: 400, lead: 8, leadSafety: 1.4 }
    const bench = plan.order.slice(4, 9)
    expect(isGarbageTime(ctxOf(players, plan, { ...hovering, onCourt: plan.starters }))).toBe(false)
    expect(isGarbageTime(ctxOf(players, plan, { ...hovering, onCourt: bench }))).toBe(true)
    // Far below the exit lead it ends for everyone.
    expect(isGarbageTime(ctxOf(players, plan, { ...hovering, lead: 4, onCourt: bench }))).toBe(
      false,
    )
  })
})

describe('closers', () => {
  it('come in for the finish of a close game unless exhausted', () => {
    const players = roster()
    const plan = buildRotationPlan(players, makeCoach(), sys())
    // Put one non-closer on the floor in place of a closer; everyone is fresh.
    const closer = plan.closers[0] as string
    const slot = plan.closers.indexOf(closer)
    const onCourt = [...plan.closers]
    const sub = plan.order.find((id) => !plan.closers.includes(id)) as string
    onCourt[slot] = sub
    const base = { period: 4, clock: 120, lead: 2, leadSafety: 0.3, onCourt }
    const subs = decideSubstitutions(ctxOf(players, plan, base), createRng(1))
    expect(subs.some((s) => s.incomingId === closer)).toBe(true)
    const tired = decideSubstitutions(
      ctxOf(players, plan, { ...base, status: fresh(players, { [closer]: { energy: 5 } }) }),
      createRng(1),
    )
    expect(tired.some((s) => s.incomingId === closer)).toBe(false)
  })
})

describe('eligibility', () => {
  it('never returns a disqualified or on-court player', () => {
    const players = roster()
    const plan = buildRotationPlan(players, makeCoach(), sys())
    const out = plan.order.slice(5, 9)
    const status = fresh(players, Object.fromEntries(out.map((id) => [id, { disqualified: true }])))
    const exhausted = fresh(players, {
      ...Object.fromEntries(plan.starters.map((id) => [id, { energy: 3, secondsPlayed: 1800 }])),
      ...Object.fromEntries(out.map((id) => [id, { disqualified: true }])),
    })
    for (const st of [status, exhausted]) {
      const ctx = ctxOf(players, plan, { status: st, clock: 300, period: 2 })
      for (const sub of decideSubstitutions(ctx, createRng(3))) {
        expect(out).not.toContain(sub.incomingId)
        expect(ctx.onCourt).not.toContain(sub.incomingId)
      }
      for (let slot = 0; slot < 5; slot++) {
        const id = chooseReplacement(ctx, slot)
        expect(id === undefined || (!out.includes(id) && !ctx.onCourt.includes(id))).toBe(true)
      }
    }
  })

  it('replaces a disqualified player on the floor from the bench', () => {
    const players = roster()
    const plan = buildRotationPlan(players, makeCoach(), sys())
    const dq = plan.starters[2] as string
    const ctx = ctxOf(players, plan, { status: fresh(players, { [dq]: { disqualified: true } }) })
    const subs = decideSubstitutions(ctx, createRng(1))
    expect(subs.find((s) => s.slot === 2)).toBeDefined()
    expect(chooseReplacement(ctx, 2)).toBeDefined()
  })

  it('returns undefined when nobody is left', () => {
    const players = roster().slice(0, 5)
    const plan = buildRotationPlan(players, makeCoach(), sys())
    expect(chooseReplacement(ctxOf(players, plan), 0)).toBeUndefined()
  })
})

describe('determinism and pacing', () => {
  /** A crude whole-game simulation: drain/recover energy, ask for subs every 30 seconds. */
  function playGame(rotationManagement: number, seed: number) {
    const players = roster()
    const coach = makeCoach({ attributes: { rotationManagement } })
    const plan = buildRotationPlan(players, coach, sys())
    const rng = createRng(seed)
    const status = fresh(players)
    let onCourt = [...plan.starters]
    const stints: number[] = []
    const lastIn: Record<string, number> = Object.fromEntries(onCourt.map((id) => [id, 0]))
    let subCount = 0
    const length = TOTAL / 5
    for (let t = 0; t < length; t += 30) {
      const period = Math.floor(t / PRO_RULES.periodSeconds) + 1
      const clock = PRO_RULES.periodSeconds - (t % PRO_RULES.periodSeconds)
      for (const p of players) {
        const s = status[p.id] as PlayerGameStatus
        if (onCourt.includes(p.id)) {
          s.energy = Math.max(0, s.energy - 0.6 * (30 / 4))
          s.secondsPlayed += 30
        } else s.energy = Math.min(100, s.energy + 0.9 * (30 / 4))
      }
      const ctx = ctxOf(players, plan, {
        period,
        clock,
        onCourt,
        status,
        coach: rotationCoachOf(coach),
      })
      for (const sub of decideSubstitutions(ctx, rng)) {
        const out = onCourt[sub.slot] as string
        stints.push(t - (lastIn[out] ?? 0))
        lastIn[sub.incomingId] = t
        onCourt = onCourt.map((id, i) => (i === sub.slot ? sub.incomingId : id))
        subCount++
      }
    }
    return { plan, status, subCount, stints, onCourt }
  }

  it('is deterministic for a seed', () => {
    const a = playGame(10, 5)
    const b = playGame(10, 5)
    expect(a.subCount).toBe(b.subCount)
    expect(a.onCourt).toEqual(b.onCourt)
  })

  it('does not churn: stints are at least a couple of minutes and subs are limited', () => {
    const { stints, subCount } = playGame(10, 7)
    expect(subCount).toBeGreaterThan(8)
    expect(subCount).toBeLessThan(90)
    const average = stints.reduce((a, b) => a + b, 0) / stints.length
    expect(average).toBeGreaterThan(150)
  })

  it('lands starters near their planned minutes with a competent coach', () => {
    const { plan, status } = playGame(15, 11)
    for (const id of plan.starters) {
      const played = (status[id]?.secondsPlayed ?? 0) / 60
      const target = (plan.targetSeconds[id] ?? 0) / 60
      expect(Math.abs(played - target)).toBeLessThan(7)
    }
  })

  it('tracks the plan more closely with high Rotation Management', () => {
    /** Mean absolute gap between played and planned seconds over the rotation. */
    const gap = (rm: number): number => {
      let total = 0
      for (let seed = 1; seed <= 5; seed++) {
        const { plan, status } = playGame(rm, seed)
        const ids = plan.order.filter((id) => (plan.targetSeconds[id] ?? 0) > 0)
        total +=
          ids.reduce(
            (s, id) =>
              s + Math.abs((status[id]?.secondsPlayed ?? 0) - (plan.targetSeconds[id] ?? 0)),
            0,
          ) / ids.length
      }
      return total / 5
    }
    expect(gap(20)).toBeLessThan(gap(1))
  })
})
