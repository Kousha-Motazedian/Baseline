/** In-game fatigue: drain, recovery, breaks, and the log-odds penalty. */
import { describe, expect, it } from 'vitest'
import {
  applyBreakRecovery,
  drainPerSecond,
  fatigueEdge,
  systemDrainFactor,
} from '../../../src/core/match/fatigue.ts'
import { runClock } from '../../../src/core/match/state.ts'
import {
  ENERGY_RECOVERY_PER_SECOND,
  HALFTIME_RECOVERY,
  QUARTER_BREAK_RECOVERY,
} from '../../../src/core/match/tuning.ts'
import { BALANCED_SYSTEM } from '../../../src/core/tactics/system.ts'
import { makeFlatTeam, makePlayer } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'

/** A fresh flat game. */
function game() {
  return makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
}

describe('energy drain and recovery', () => {
  it('everyone starts at 100', () => {
    const g = game()
    expect([...g.home.energy.values()].every((e) => e === 100)).toBe(true)
  })

  it('drains players on the floor and refills the bench', () => {
    const g = game()
    const bench = g.home.team.roster[7]
    if (!bench) throw new Error('no bench')
    g.home.energy.set(bench.id, 50)
    runClock(g, 60)
    const starter = g.home.onCourt[0]
    if (!starter) throw new Error('no starter')
    expect(g.home.energy.get(starter.id)).toBeLessThan(100)
    expect(g.home.energy.get(bench.id)).toBeCloseTo(50 + 60 * ENERGY_RECOVERY_PER_SECOND, 9)
  })

  it('Stamina 20 drains about half as fast as Stamina 1', () => {
    const low = makePlayer({ id: 'l', attributes: { stamina: 1 } })
    const high = makePlayer({ id: 'h', attributes: { stamina: 20 } })
    expect(drainPerSecond(high, 1) / drainPerSecond(low, 1)).toBeCloseTo(0.5, 9)
  })

  it('recovery is faster than the average drain', () => {
    const avg = makePlayer({ id: 'a' })
    expect(ENERGY_RECOVERY_PER_SECOND).toBeGreaterThan(drainPerSecond(avg, 1))
  })

  it('fast pace, pushing and aggressive pressure drain faster; balanced is neutral', () => {
    expect(systemDrainFactor(BALANCED_SYSTEM)).toBe(1)
    expect(systemDrainFactor({ ...BALANCED_SYSTEM, pace: 'fast' })).toBeGreaterThan(1)
    expect(systemDrainFactor({ ...BALANCED_SYSTEM, transition: 'push' })).toBeGreaterThan(1)
    expect(
      systemDrainFactor({ ...BALANCED_SYSTEM, defensivePressure: 'aggressive' }),
    ).toBeGreaterThan(1)
  })

  it('breaks restore energy: more at halftime than at a quarter break, capped at 100', () => {
    const g = game()
    const p = g.home.team.roster[0]
    if (!p) throw new Error('no player')
    g.home.energy.set(p.id, 30)
    g.period = 2
    applyBreakRecovery(g)
    expect(g.home.energy.get(p.id)).toBe(30 + QUARTER_BREAK_RECOVERY)
    g.home.energy.set(p.id, 30)
    g.period = 3
    applyBreakRecovery(g)
    expect(g.home.energy.get(p.id)).toBe(30 + HALFTIME_RECOVERY)
    g.home.energy.set(p.id, 99)
    applyBreakRecovery(g)
    expect(g.home.energy.get(p.id)).toBe(100)
  })
})

describe('fatigue edge', () => {
  it('is zero when fresh, negative and growing as energy falls, steep when exhausted', () => {
    const g = game()
    const p = g.home.onCourt[0]
    if (!p) throw new Error('no player')
    const at = (energy: number): number => {
      g.home.energy.set(p.id, energy)
      return fatigueEdge(g.home, p)
    }
    expect(at(100)).toBe(0)
    expect(at(80)).toBeLessThan(0)
    expect(at(80)).toBeGreaterThan(-0.1)
    expect(at(50)).toBeLessThan(at(80))
    expect(at(10)).toBeLessThan(at(50) * 2)
  })

  it('Hustle softens it', () => {
    const g = makeGameState({
      home: {
        ...makeFlatTeam('A', 10),
        roster: [
          makePlayer({ id: 'h', attributes: { hustle: 20 } }),
          makePlayer({ id: 'l', attributes: { hustle: 1 } }),
          ...makeFlatTeam('A', 10).roster.slice(2),
        ],
      },
      away: makeFlatTeam('B', 10),
    })
    g.home.energy.set('h', 30)
    g.home.energy.set('l', 30)
    const hard = g.home.team.roster[0]
    const soft = g.home.team.roster[1]
    if (!hard || !soft) throw new Error('missing')
    expect(fatigueEdge(g.home, hard)).toBeGreaterThan(fatigueEdge(g.home, soft))
  })
})
