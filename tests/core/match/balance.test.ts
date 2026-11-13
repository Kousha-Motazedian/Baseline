/**
 * Scaled-down versions of the `npm run sim:batch -- --balance` checks, so a change that breaks
 * offense/defense balance or league invariance fails CI, not just a manual batch run. Paired
 * design (same teams, same game seeds per variant) as in tools/batch-sim.ts, which removes most of
 * the between-team noise. Tolerances are wide because 300 games is ~7x fewer than the tool runs.
 */
import { describe, expect, it } from 'vitest'
import { simulateGame } from '../../../src/core/match/game.ts'
import type { MatchResult, MatchTeam } from '../../../src/core/match/types.ts'
import { PLAY_TYPES } from '../../../src/core/match/types.ts'
import {
  DEFENSIVE_ATTRIBUTE_KEYS,
  OFFENSIVE_ATTRIBUTE_KEYS,
  VISIBLE_ATTRIBUTE_KEYS,
} from '../../../src/core/players/attributes.ts'
import { PRO_RULES } from '../../../src/core/world/rules.ts'
import { boostTeam, generatedPair } from '../../helpers/fixtures.ts'
import { sides } from '../../helpers/simulation.ts'

/** Paired games per variant. */
const PAIRS = 300

/** Points for/against (team "home" = the boosted side) and possessions over a series. */
interface Tally {
  pointsFor: number
  pointsAgainst: number
  possessions: number
}

/** Plays game `i` with home court alternating, so the home edge cancels across the series. */
function play(team: MatchTeam, opponent: MatchTeam, i: number): MatchResult {
  const teamIsHome = i % 2 === 0
  return simulateGame({
    home: teamIsHome ? team : opponent,
    away: teamIsHome ? opponent : team,
    rules: PRO_RULES,
    seed: 50_000 + i,
  })
}

/** Runs PAIRS games where `transform` produces the two teams from a fresh generated pair. */
function runVariant(transform: (a: MatchTeam, b: MatchTeam) => [MatchTeam, MatchTeam]): {
  tally: Tally
  results: MatchResult[]
} {
  const tally: Tally = { pointsFor: 0, pointsAgainst: 0, possessions: 0 }
  const results: MatchResult[] = []
  for (let i = 0; i < PAIRS; i++) {
    const [a, b] = transform(...generatedPair(90_000 + i))
    const result = play(a, b, i)
    const [us, them] = sides(result, 'home')
    tally.pointsFor += us.points
    tally.pointsAgainst += them.points
    tally.possessions += (us.possessions + them.possessions) / 2
    results.push(result)
  }
  return { tally, results }
}

/** Net rating of the "home"-id team, per 100 possessions. */
function net(t: Tally): number {
  return ((t.pointsFor - t.pointsAgainst) / t.possessions) * 100
}

/** League scoring: both teams' points per 100 possessions, averaged. */
function leagueRating(t: Tally): number {
  return ((t.pointsFor + t.pointsAgainst) / 2 / t.possessions) * 100
}

/** Share of all FGA by play type across a set of results. */
function shotMix(results: readonly MatchResult[]): number[] {
  const totals = PLAY_TYPES.map((type) =>
    results.reduce(
      (s, r) => s + r.home.shotsByPlayType[type].attempted + r.away.shotsByPlayType[type].attempted,
      0,
    ),
  )
  const all = totals.reduce((s, x) => s + x, 0)
  return totals.map((x) => x / all)
}

const base = runVariant((a, b) => [a, b])
const offense = runVariant((a, b) => [boostTeam(a, OFFENSIVE_ATTRIBUTE_KEYS, 3), b])
const defense = runVariant((a, b) => [boostTeam(a, DEFENSIVE_ATTRIBUTE_KEYS, 3), b])
const league = runVariant((a, b) => [
  boostTeam(a, VISIBLE_ATTRIBUTE_KEYS, 3),
  boostTeam(b, VISIBLE_ATTRIBUTE_KEYS, 3),
])

describe('offense vs. defense balance (300 paired games)', () => {
  const offenseGain = net(offense.tally) - net(base.tally)
  const defenseGain = net(defense.tally) - net(base.tally)

  it('rewards +3 on offensive attributes and +3 on defensive attributes', () => {
    // Batch tool (2,000 games × 5 seeds, round 3): offense ≈ +11.9–13.2, defense ≈ +8.0–9.3 per 100.
    expect(offenseGain).toBeGreaterThan(10)
    expect(defenseGain).toBeGreaterThan(6)
  })

  it('values offense somewhat more than defense (target 1.3–1.5 : 1, wide band for sample size)', () => {
    const ratio = offenseGain / defenseGain
    expect(ratio).toBeGreaterThan(1.1)
    expect(ratio).toBeLessThan(1.9)
  })
})

describe('league invariance (300 paired games)', () => {
  it('barely changes league scoring when every rating rises by 3', () => {
    // Only uncontested free throws should move it (batch tool: +1.2 to +1.7 per 100).
    const shift = leagueRating(league.tally) - leagueRating(base.tally)
    expect(Math.abs(shift)).toBeLessThan(3)
  })

  it('keeps the same shot mix when every rating rises by 3', () => {
    const before = shotMix(base.results)
    const after = shotMix(league.results)
    // ≈ 50,000 FGA per side: a share's SE is ≤ 0.003, so 0.012 is ~4 SE.
    before.forEach((share, i) => expect(Math.abs((after[i] ?? 0) - share)).toBeLessThan(0.012))
  })
})
