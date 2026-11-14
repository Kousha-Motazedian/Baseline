import { describe, expect, it } from 'vitest'
import { simulateGame } from '../../../src/core/match/game.ts'
import type { MatchResult } from '../../../src/core/match/types.ts'
import { PRO_RULES } from '../../../src/core/world/rules.ts'
import { VISIBLE_ATTRIBUTE_KEYS } from '../../../src/core/players/attributes.ts'
import {
  boostTeam,
  cloneTeam,
  generatedPair,
  makeFlatTeam,
  patchTeam,
} from '../../helpers/fixtures.ts'
import { expectValidResult } from '../../helpers/invariants.ts'
import {
  gameSeconds,
  mean,
  playSeries,
  sides,
  SLOW_TEST_TIMEOUT_MS,
} from '../../helpers/simulation.ts'

describe('small rosters', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('rejects a roster with fewer than 5 players', () => {
    expect(() =>
      simulateGame({
        home: makeFlatTeam('A', 10, 4),
        away: makeFlatTeam('B', 10),
        rules: PRO_RULES,
        seed: 1,
      }),
    ).toThrow(RangeError)
  })

  /** Undisciplined 5-man team against a maximally aggressive offense: fouls pile up fast. */
  function fiveManSeries(): MatchResult[] {
    const fiveMan = patchTeam(makeFlatTeam('F', 10.5, 5), { discipline: 1 })
    const attackers = patchTeam(makeFlatTeam('X', 10.5), { aggression: 20 })
    return playSeries(fiveMan, attackers, 30)
  }

  it('finishes valid games with exactly 5 players even when they foul out (no bench)', () => {
    for (const r of fiveManSeries()) {
      expectValidResult(r, PRO_RULES)
      const [team] = sides(r, 'F')
      expect(team.players).toHaveLength(5)
      // With no bench, everyone plays the whole game, except a player ejected on technicals:
      // he always leaves the floor (only foul-outs stay on under the pro no-bench rule).
      for (const line of team.players) {
        if (line.technicalFouls >= PRO_RULES.technicalFoulsToEject) {
          expect(line.secondsPlayed).toBeLessThan(gameSeconds(r, PRO_RULES))
        } else {
          expect(line.secondsPlayed).toBeCloseTo(gameSeconds(r, PRO_RULES), 6)
        }
      }
    }
  })

  // Pro rule: with no eligible sub, a disqualified player stays on, and each further foul is
  // charged as a technical (opponent free throw) instead of another personal foul.
  it('never lets a player exceed the foul limit, even with no bench', () => {
    let overLimit = 0
    for (const r of fiveManSeries()) {
      for (const line of sides(r, 'F')[0].players) {
        if (line.personalFouls > PRO_RULES.personalFoulLimit) overLimit++
      }
    }
    expect(overLimit).toBe(0)
  })

  it('handles a 6-man roster once the only sub has also fouled out', () => {
    const sixMan = patchTeam(makeFlatTeam('S', 10.5, 6), { discipline: 1 })
    const attackers = patchTeam(makeFlatTeam('X', 10.5), { aggression: 20 })
    for (const r of playSeries(sixMan, attackers, 20)) expectValidResult(r, PRO_RULES)
  })
})

describe('extreme ratings', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('produces valid, finite games at the ends of the scale (1 vs 20, 1 vs 1, 20 vs 20)', () => {
    for (const [a, b] of [
      [1, 20],
      [1, 1],
      [20, 20],
    ] as const) {
      for (const r of playSeries(makeFlatTeam('A', a), makeFlatTeam('B', b), 10)) {
        expectValidResult(r, PRO_RULES)
      }
    }
  })

  it('lets an all-20 team beat an all-1 team every time, by a lot', () => {
    const results = playSeries(makeFlatTeam('S', 20), makeFlatTeam('W', 1), 50)
    const margins = results.map((r) => {
      const [strong, weak] = sides(r, 'S')
      return strong.points - weak.points
    })
    expect(Math.min(...margins)).toBeGreaterThan(0)
    expect(mean(margins)).toBeGreaterThan(40)
  })

  it('handles ratings above 20 (balance tools add +3 without clamping)', () => {
    for (const r of playSeries(makeFlatTeam('A', 23), makeFlatTeam('B', 18), 10)) {
      expectValidResult(r, PRO_RULES)
    }
  })

  it('keeps a modestly better team (+2 everywhere) a clear but not certain favourite', () => {
    const [base, opponent] = generatedPair(31)
    const better = boostTeam(base, VISIBLE_ATTRIBUTE_KEYS, 2)
    const wins = playSeries(better, opponent, 200).filter((r) => {
      const [us, them] = sides(r, 'home')
      return us.points > them.points
    }).length
    // +2 on every attribute is a big edge (≈ +11 net/100 per the balance tests) but upsets must
    // still happen: anything outside 70–99% would mean the engine is too random or too deterministic.
    expect(wins / 200).toBeGreaterThan(0.7)
    expect(wins / 200).toBeLessThan(0.99)
  })
})

describe('evenly matched teams', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('splits games between identical rosters, with a small home edge', () => {
    const [team] = generatedPair(41)
    const a = cloneTeam(team, 'A')
    const b = cloneTeam(team, 'B')
    // 600 games, home alternating: SE of a win rate ≈ 0.02, so ±0.07 bands are > 3 SE.
    const results = playSeries(a, b, 600)
    const aWins = results.filter((r) => sides(r, 'A')[0].points > sides(r, 'B')[0].points).length
    const homeWins = results.filter((r) => r.home.points > r.away.points).length
    expect(Math.abs(aWins / 600 - 0.5)).toBeLessThan(0.07)
    expect(homeWins / 600).toBeGreaterThan(0.48)
    expect(homeWins / 600).toBeLessThan(0.62)
    const homeMargin = mean(results.map((r) => r.home.points - r.away.points))
    // HOME_SHOOTING_EDGE is meant to be worth ~1–2 points; margin SE over 600 games ≈ 0.8.
    expect(homeMargin).toBeGreaterThan(-1)
    expect(homeMargin).toBeLessThan(4.5)
  })
})
