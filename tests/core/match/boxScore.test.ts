import { describe, expect, it } from 'vitest'
import { simulateGame } from '../../../src/core/match/game.ts'
import type { MatchResult } from '../../../src/core/match/types.ts'
import { PRO_RULES } from '../../../src/core/world/rules.ts'
import { generatedPair } from '../../helpers/fixtures.ts'
import { expectValidResult } from '../../helpers/invariants.ts'
import { gameSeconds, mean, SLOW_TEST_TIMEOUT_MS, teamTotal } from '../../helpers/simulation.ts'

/** 200 seeded games between freshly generated average teams (≈1 s; enough to hit overtimes). */
function sampleGames(): MatchResult[] {
  return Array.from({ length: 200 }, (_, seed) => {
    const [home, away] = generatedPair(1_000 + seed)
    return simulateGame({ home, away, rules: PRO_RULES, seed })
  })
}

const games = sampleGames()

describe('box score integrity (200 generated games)', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('satisfies every box score and play-by-play invariant in every game', () => {
    for (const result of games) expectValidResult(result, PRO_RULES)
  })

  it('includes at least one overtime game in the sample, so overtime paths are covered', () => {
    expect(games.some((r) => r.periodsPlayed > PRO_RULES.periods)).toBe(true)
  })

  it('lists every roster player exactly once, in roster order', () => {
    const [home, away] = generatedPair(1_000)
    const first = games[0]
    expect(first?.home.players.map((l) => l.playerId)).toEqual(home.roster.map((p) => p.id))
    expect(first?.away.players.map((l) => l.playerId)).toEqual(away.roster.map((p) => p.id))
  })

  it('keeps both teams within a couple of possessions of each other', () => {
    // Possessions alternate, so the only imbalance is which team starts each period: at most
    // 2 in regulation (expectValidResult checks the exact bound), and usually 0 or 1.
    const diffs = games.map((r) => Math.abs(r.home.possessions - r.away.possessions))
    expect(Math.max(...diffs)).toBeLessThanOrEqual(3)
    expect(mean(diffs)).toBeLessThan(1.5)
  })

  it('produces realistic game-level ranges (no runaway or empty scores)', () => {
    for (const r of games) {
      for (const team of [r.home, r.away]) {
        expect(team.points).toBeGreaterThan(70)
        expect(team.points).toBeLessThan(170)
        // Per 48 minutes, so a double-overtime game (~58 minutes) isn't flagged as runaway pace.
        const per48 = (team.possessions / gameSeconds(r, PRO_RULES)) * 48 * 60
        expect(per48).toBeGreaterThan(85)
        expect(per48).toBeLessThan(125)
        expect(teamTotal(team, 'fieldGoalsAttempted')).toBeGreaterThan(60)
      }
    }
  })
})
