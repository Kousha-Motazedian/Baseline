import { describe, expect, it } from 'vitest'
import { simulateGame } from '../../../src/core/match/game.ts'
import type { MatchResult, MatchTeam } from '../../../src/core/match/types.ts'
import type { LeagueRules } from '../../../src/core/world/rules.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { generatedPair, makeFlatTeam, patchTeam } from '../../helpers/fixtures.ts'
import { expectValidResult } from '../../helpers/invariants.ts'
import { gameSeconds, mean, playSeries, SLOW_TEST_TIMEOUT_MS } from '../../helpers/simulation.ts'

/** Finds the first `count` overtime games among generated matchups (OT happens in ~2% of games). */
function findOvertimeGames(rules: LeagueRules, count: number): MatchResult[] {
  const found: MatchResult[] = []
  for (let seed = 0; seed < 3_000 && found.length < count; seed++) {
    const [home, away] = generatedPair(seed)
    const result = simulateGame({ home, away, rules, seed })
    if (result.periodsPlayed > rules.periods) found.push(result)
  }
  return found
}

/** Score at the "End of <period>" play-by-play line for a given period number. */
function scoreAtEndOf(result: MatchResult, period: number): [number, number] {
  const entry = result.playByPlay
    .filter((e) => e.period === period && e.text.startsWith('End of'))
    .at(-1)
  if (!entry) throw new Error(`no end-of-period line for period ${period}`)
  return [entry.homeScore, entry.awayScore]
}

/**
 * A matchup built to produce lots of fouls: the home side is maximally aggressive, the away side
 * has no discipline, so away players foul out regularly.
 */
function foulHeavyMatchup(): [MatchTeam, MatchTeam] {
  return [
    patchTeam(makeFlatTeam('H', 10.5), { aggression: 20 }),
    patchTeam(makeFlatTeam('A', 10.5), { discipline: 1 }),
  ]
}

/** True if a play-by-play line mentions this exact last name (not just a prefix of a longer one). */
function mentions(text: string, lastName: string): boolean {
  return new RegExp(`\\b${lastName}\\b`).test(text)
}

describe('game length rules', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('plays fewer possessions and scores fewer points under FIBA (40 min) than pro (48 min)', () => {
    const [home, away] = generatedPair(21)
    const pro = playSeries(home, away, 40, { rules: PRO_RULES })
    const fiba = playSeries(home, away, 40, { rules: FIBA_RULES })
    const poss = (rs: MatchResult[]): number =>
      mean(rs.map((r) => r.home.possessions + r.away.possessions))
    const pts = (rs: MatchResult[]): number => mean(rs.map((r) => r.home.points + r.away.points))
    // Expected ratio ≈ 40/48 ≈ 0.83 for both; ±0.05 covers noise over 40 games.
    expect(poss(fiba) / poss(pro)).toBeGreaterThan(0.78)
    expect(poss(fiba) / poss(pro)).toBeLessThan(0.88)
    expect(pts(fiba) / pts(pro)).toBeLessThan(0.9)
    for (const r of fiba) expectValidResult(r, FIBA_RULES)
  })

  it('supports other period structures as data (two 20-minute halves)', () => {
    const halves: LeagueRules = { ...PRO_RULES, name: 'Halves', periods: 2, periodSeconds: 20 * 60 }
    const [home, away] = generatedPair(22)
    for (const r of playSeries(home, away, 20, { rules: halves })) {
      expectValidResult(r, halves)
      expect(r.home.periodPoints.length).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('overtime', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  const overtimeGames = findOvertimeGames(PRO_RULES, 4)

  it('finds overtime games to test', () => {
    expect(overtimeGames.length).toBe(4)
  })

  it('only goes to overtime from a tie, keeps going while tied, and stops once someone leads', () => {
    for (const r of overtimeGames) {
      for (let period = PRO_RULES.periods; period < r.periodsPlayed; period++) {
        const [home, away] = scoreAtEndOf(r, period)
        expect(home).toBe(away)
      }
      const [home, away] = scoreAtEndOf(r, r.periodsPlayed)
      expect(home).not.toBe(away)
      expectValidResult(r, PRO_RULES)
    }
  })

  it('plays 5-minute overtime periods', () => {
    for (const r of overtimeGames) {
      const otEntries = r.playByPlay.filter((e) => e.period > PRO_RULES.periods)
      expect(Math.max(...otEntries.map((e) => e.clockSeconds))).toBeLessThanOrEqual(300)
      // The first event of an OT period happens within one possession (≤ 24 s) of tip-off.
      const firstOt = otEntries[0]
      expect(firstOt?.clockSeconds).toBeGreaterThanOrEqual(300 - 24)
      expect(otEntries.some((e) => e.text === 'End of OT')).toBe(true)
    }
  })

  it('uses the configured overtime length (rules are data)', () => {
    const shortOt: LeagueRules = { ...PRO_RULES, name: 'Short OT', overtimeSeconds: 120 }
    const games = findOvertimeGames(shortOt, 2)
    expect(games.length).toBe(2)
    for (const r of games) expectValidResult(r, shortOt)
  })
})

describe('foul-outs', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  for (const rules of [PRO_RULES, FIBA_RULES]) {
    it(`never lets a player exceed ${rules.personalFoulLimit} fouls with a full bench (${rules.name})`, () => {
      const [home, away] = foulHeavyMatchup()
      const results = playSeries(home, away, 30, { rules, alternateHome: false })
      let foulOuts = 0
      for (const r of results) {
        expectValidResult(r, rules)
        for (const line of [...r.home.players, ...r.away.players]) {
          expect(line.personalFouls).toBeLessThanOrEqual(rules.personalFoulLimit)
          if (line.personalFouls === rules.personalFoulLimit) foulOuts++
        }
      }
      // The matchup is built so foul-outs actually happen; otherwise this test proves nothing.
      expect(foulOuts).toBeGreaterThan(5)
    })
  }

  it('removes a fouled-out player for good: no play-by-play mentions after the foul-out', () => {
    const [home, away] = foulHeavyMatchup()
    let checked = 0
    for (const r of playSeries(home, away, 30, { alternateHome: false })) {
      r.playByPlay.forEach((entry, index) => {
        const match = /^(\S+) fouls out;/.exec(entry.text)
        if (!match?.[1]) return
        const name = match[1]
        const later = r.playByPlay.slice(index + 1)
        expect(later.filter((e) => mentions(e.text, name))).toEqual([])
        checked++
      })
    }
    expect(checked).toBeGreaterThan(5)
  })

  it('gives fouled-out starters less than a full game of minutes', () => {
    const [home, away] = foulHeavyMatchup()
    let fouledOut = 0
    for (const r of playSeries(home, away, 10, { alternateHome: false })) {
      for (const line of r.away.players) {
        if (line.personalFouls < PRO_RULES.personalFoulLimit) continue
        expect(line.secondsPlayed).toBeLessThan(gameSeconds(r, PRO_RULES))
        fouledOut++
      }
    }
    expect(fouledOut).toBeGreaterThan(0)
  })
})
