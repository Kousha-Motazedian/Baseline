/**
 * Timeout rules and mechanics (docs/design/timeouts.md, sections 1-2): the limits per league,
 * what a called timeout does, and the Game Management end-game decisions.
 */
import { describe, expect, it } from 'vitest'
import {
  foulDeficitFactor,
  foulWindowSeconds,
  lastShotTimingError,
  rollEndGameLapses,
  twoForOneChance,
  tyingThreeWeight,
} from '../../../src/core/match/endGame.ts'
import { simulateGame } from '../../../src/core/match/game.ts'
import type { TimeoutUse } from '../../../src/core/match/timeouts.ts'
import {
  afterTimeoutEdge,
  runTimeoutWindow,
  takeSavedSeconds,
  timeoutAvailability,
} from '../../../src/core/match/timeouts.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { makeFlatTeam } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'

/** `n` timeouts used in `period` with `clock` left. */
function uses(n: number, period: number, clock = 400): TimeoutUse[] {
  return Array.from({ length: n }, () => ({ period, clock }))
}

describe('timeout allowances (league rules)', () => {
  it('pro: one pool of 7 for the game', () => {
    expect(timeoutAvailability(PRO_RULES, [], 1, 700)).toEqual({ usable: 7, total: 7 })
    expect(timeoutAvailability(PRO_RULES, uses(3, 1).concat(uses(2, 2)), 3, 500).usable).toBe(2)
  })

  it('pro: at most 4 in the 4th quarter, at most 2 in its last 3:00', () => {
    // Nothing used before the 4th: the 4th-quarter cap binds.
    expect(timeoutAvailability(PRO_RULES, [], 4, 500)).toEqual({ usable: 4, total: 4 })
    // Two used with 5:00 left: still 2 left in the quarter; the 3:00 window allows 2.
    expect(timeoutAvailability(PRO_RULES, uses(2, 4, 300), 4, 170)).toEqual({ usable: 2, total: 2 })
    // Two used inside the last 3:00: none usable now, though two remain for the quarter.
    const late = uses(2, 4, 150)
    expect(timeoutAvailability(PRO_RULES, late, 4, 100)).toEqual({ usable: 0, total: 2 })
  })

  it('pro: overtime gives 2 fresh timeouts plus the unused regulation ones', () => {
    expect(timeoutAvailability(PRO_RULES, uses(5, 2), 5, 300)).toEqual({ usable: 4, total: 4 })
    // Using 3 in the first overtime spends the 2 fresh and 1 carried; the second OT is fresh again.
    const used = uses(5, 2).concat(uses(3, 5))
    expect(timeoutAvailability(PRO_RULES, used, 6, 300).usable).toBe(2 + 1)
  })

  it('FIBA: 2 in the first half, 3 in the second, first-half leftovers are lost', () => {
    expect(timeoutAvailability(FIBA_RULES, [], 1, 500).usable).toBe(2)
    expect(timeoutAvailability(FIBA_RULES, uses(1, 2), 2, 400).usable).toBe(1)
    expect(timeoutAvailability(FIBA_RULES, [], 3, 500).usable).toBe(3)
    expect(timeoutAvailability(FIBA_RULES, uses(2, 1), 3, 500).usable).toBe(3)
  })

  it('FIBA: at most 2 in the last 2:00 of the 4th; overtime is 1 and nothing carries over', () => {
    const late = uses(2, 4, 100)
    expect(timeoutAvailability(FIBA_RULES, late, 4, 60)).toEqual({ usable: 0, total: 1 })
    expect(timeoutAvailability(FIBA_RULES, uses(1, 4, 100), 4, 60).usable).toBe(1)
    expect(timeoutAvailability(FIBA_RULES, [], 5, 300)).toEqual({ usable: 1, total: 1 })
  })
})

describe('a called timeout', () => {
  it('is logged, counted, rests both teams and sets up the next possession', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10.5),
      away: makeFlatTeam('B', 10.5),
      period: 4,
      clock: 100,
      seed: 3,
    })
    // Bring tired legs so the recovery is visible.
    for (const team of [game.home, game.away]) team.energy.set(team.onCourt[0]?.id ?? '', 50)
    game.home.points = 90
    game.away.points = 95
    // The stub/real coach stops the clock trailing late after an opponent score.
    const called = runTimeoutWindow(game, game.home, game.away, true)
    expect(called).toBe(true)
    expect(game.home.timeoutLog).toHaveLength(1)
    expect(game.playByPlay.some((e) => /^Timeout/.test(e.text))).toBe(true)
    expect(game.home.energy.get(game.home.onCourt[0]?.id ?? '')).toBeGreaterThan(50)
    // The ball is advanced in the last 2:00: 4-6 s saved for the team with the ball (home).
    const saved = takeSavedSeconds(game.home)
    expect(saved).toBeGreaterThanOrEqual(4)
    expect(saved).toBeLessThanOrEqual(6)
    // Only once.
    expect(takeSavedSeconds(game.home)).toBe(0)
    expect(game.home.afterTimeout?.edge).toBeGreaterThan(0)
  })

  it('never exceeds the rules, and at most one is taken per dead ball', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10.5),
      away: makeFlatTeam('B', 10.5),
      period: 4,
      clock: 100,
      seed: 4,
    })
    game.home.points = 90
    game.away.points = 95
    game.home.timeoutLog.push(...uses(2, 4, 150))
    // Home has used its two late timeouts; the window must not give it a third.
    runTimeoutWindow(game, game.home, game.away, true)
    expect(game.home.timeoutLog).toHaveLength(2)
  })

  it('the drawn-up play scales with Game Management', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10.5), away: makeFlatTeam('B', 10.5) })
    const poor = { ...game.home, coach: { rotationManagement: 10, gameManagement: 1 } }
    const good = { ...game.home, coach: { rotationManagement: 10, gameManagement: 20 } }
    expect(afterTimeoutEdge(good)).toBeGreaterThan(afterTimeoutEdge(poor))
    expect(afterTimeoutEdge(poor)).toBeGreaterThan(0)
  })

  it('whole games: timeouts are counted per team and never exceed the league limit', () => {
    for (const [rules, max] of [
      [PRO_RULES, 7 + 2 * 3],
      [FIBA_RULES, 5 + 3],
    ] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        const result = simulateGame({
          home: makeFlatTeam('A', 10.5),
          away: makeFlatTeam('B', 10.5),
          rules,
          seed,
        })
        for (const side of [result.home, result.away]) {
          expect(side.timeouts).toBeLessThanOrEqual(max)
        }
        const logged = result.playByPlay.filter((e) => /^Timeout/.test(e.text)).length
        expect(logged).toBe(result.home.timeouts + result.away.timeouts)
      }
    }
  })
})

describe('end-game decisions by Game Management', () => {
  const poor = { rotationManagement: 10.5, gameManagement: 1 }
  const neutral = { rotationManagement: 10.5, gameManagement: 10.5 }
  const good = { rotationManagement: 10.5, gameManagement: 20 }

  it('a poor coach starts fouling later and keeps fouling at bigger deficits', () => {
    expect(foulWindowSeconds(poor, 30)).toBeLessThan(foulWindowSeconds(neutral, 30))
    expect(foulWindowSeconds(neutral, 30)).toBe(30)
    expect(foulWindowSeconds(good, 30)).toBeGreaterThan(30)
    expect(foulDeficitFactor(poor)).toBeGreaterThan(foulDeficitFactor(neutral))
    expect(foulDeficitFactor(neutral)).toBe(1)
  })

  it('fouling up 3 and the 2-for-1 are consistent for a good coach and rare for a poor one', () => {
    expect(twoForOneChance(good)).toBeGreaterThan(twoForOneChance(neutral))
    expect(twoForOneChance(neutral)).toBeGreaterThan(twoForOneChance(poor))
    const share = (coach: typeof good): number => {
      const rng = createRng(11)
      let n = 0
      for (let i = 0; i < 2000; i++) if (rollEndGameLapses(rng, coach).foulsUpThree) n++
      return n / 2000
    }
    expect(share(good)).toBeGreaterThan(0.95)
    expect(share(poor)).toBeLessThan(0.2)
  })

  it('only a below-neutral coach forgets the chase foul or misjudges the last shot', () => {
    const rng = createRng(5)
    for (let i = 0; i < 200; i++) {
      expect(rollEndGameLapses(rng, neutral).missesChaseFoul).toBe(false)
      expect(lastShotTimingError(rng, neutral)).toBe(0)
      expect(lastShotTimingError(rng, good)).toBe(0)
    }
    const errors = Array.from({ length: 200 }, () => lastShotTimingError(rng, poor))
    expect(errors.some((e) => Math.abs(e) > 1)).toBe(true)
  })

  it('a poor coach drifts away from the tying shot down 2 or 3', () => {
    expect(tyingThreeWeight(neutral, 10)).toBe(10)
    expect(tyingThreeWeight(good, 10)).toBe(10)
    expect(tyingThreeWeight(poor, 10)).toBeLessThan(10)
    expect(tyingThreeWeight(poor, 0.5)).toBeGreaterThan(0.5)
  })
})
