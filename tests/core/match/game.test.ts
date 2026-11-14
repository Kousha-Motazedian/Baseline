import { describe, expect, it } from 'vitest'
import { generateTeam } from '../../../src/core/data/teamGenerator.ts'
import { simulateGame } from '../../../src/core/match/game.ts'
import type { MatchTeam } from '../../../src/core/match/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { PRO_RULES } from '../../../src/core/world/rules.ts'

/** Two generated league teams (realistic rosters, stars included) from a seed. */
function teams(seed: number): [MatchTeam, MatchTeam] {
  const rng = createRng(seed)
  return [generateTeam(rng, { id: 'home' }), generateTeam(rng, { id: 'away' })]
}

describe('simulateGame', () => {
  it('replays the exact same game for the same seed', () => {
    const [home, away] = teams(1)
    const a = simulateGame({ home, away, rules: PRO_RULES, seed: 42 })
    const b = simulateGame({ home, away, rules: PRO_RULES, seed: 42 })
    expect(a).toEqual(b)
  })

  it('never ends in a tie and box scores add up to the final score', () => {
    for (let seed = 0; seed < 30; seed++) {
      const [home, away] = teams(seed)
      const result = simulateGame({ home, away, rules: PRO_RULES, seed })
      expect(result.home.points).not.toBe(result.away.points)
      for (const team of [result.home, result.away]) {
        const playerPoints = team.players.reduce((sum, line) => sum + line.points, 0)
        const periodPoints = team.periodPoints.reduce((sum, p) => sum + p, 0)
        expect(playerPoints).toBe(team.points)
        expect(periodPoints).toBe(team.points)
        expect(team.periodPoints).toHaveLength(result.periodsPlayed)
      }
    }
  })

  it('credits 5 players x full game length in minutes played', () => {
    const [home, away] = teams(7)
    const result = simulateGame({ home, away, rules: PRO_RULES, seed: 7 })
    const overtimes = result.periodsPlayed - PRO_RULES.periods
    const gameSeconds =
      PRO_RULES.periods * PRO_RULES.periodSeconds + overtimes * PRO_RULES.overtimeSeconds
    const seconds = result.home.players.reduce((sum, line) => sum + line.secondsPlayed, 0)
    expect(seconds).toBeCloseTo(5 * gameSeconds, 6)
  })
})
