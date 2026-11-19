/**
 * Team systems in the match engine: the no-coaching / golden-game hash, determinism, and
 * sensitivity tests (each setting moves its lever in the right direction). Every series is seeded
 * and compares the same matchup with one change, on the same game seeds.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { generateTeam } from '../../../src/core/data/teamGenerator.ts'
import { simulateGame } from '../../../src/core/match/game.ts'
import type { MatchResult, MatchTeam, PlayType } from '../../../src/core/match/types.ts'
import { PLAY_TYPES } from '../../../src/core/match/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import type { TeamSystem } from '../../../src/core/tactics/system.ts'
import { buildRotationPlan } from '../../../src/core/tactics/rotation.ts'
import { archetypeSystem, BALANCED_SYSTEM } from '../../../src/core/tactics/system.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { runningSystem, systemOnly } from '../../helpers/coaching.ts'
import { generatedPair } from '../../helpers/fixtures.ts'
import { playSeries, seriesTotal, sides, SLOW_TEST_TIMEOUT_MS } from '../../helpers/simulation.ts'

/**
 * SHA-256 of 40 fixed-seed games (league teams, every 4th under FIBA rules), recorded after
 * rotations (the real tactics/rotation code) and fatigue were added and calibrated (rotations
 * change every game, so the pre-rotations hash 730b3188... from the pre-systems engine is
 * retired). Any change to the engine, the rotation code or the RNG draw order changes it:
 * re-record it deliberately and say why in the commit.
 */
const GOLDEN_HASH = '75663692a37bba19e81c76fb795a998341f5d45c24225851764d4c019e451a11'

/** Hash of the 40 golden games, with both teams given `coaching` (or none). */
function goldenHash(coaching: MatchTeam['coaching']): string {
  const hash = createHash('sha256')
  for (let i = 0; i < 40; i++) {
    const rng = createRng(1000 + i)
    const home = generateTeam(rng, { id: 'home' })
    const away = generateTeam(rng, { id: 'away' })
    const rules = i % 4 === 3 ? FIBA_RULES : PRO_RULES
    const coached = (team: MatchTeam): MatchTeam => (coaching ? { ...team, coaching } : team)
    hash.update(
      JSON.stringify(
        simulateGame({ home: coached(home), away: coached(away), rules, seed: 77 + i }),
      ),
    )
  }
  return hash.digest('hex')
}

describe('golden games', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('reproduces the recorded games byte for byte without coaching', () => {
    expect(goldenHash(undefined)).toBe(GOLDEN_HASH)
  })

  it('the balanced system with zero execution edges is the same as no coaching', () => {
    expect(goldenHash(systemOnly(BALANCED_SYSTEM))).toBe(GOLDEN_HASH)
  })

  it('is deterministic: the same seed gives the same games twice', () => {
    expect(goldenHash(undefined)).toBe(goldenHash(undefined))
  })
})

/** Games per series. */
const GAMES = 60

/** The base matchup: two generated average teams (ids "home"/"away"). */
const [TEAM, OPPONENT] = generatedPair(51)

/** Plays the series with the home team running `patch` (and the opponent optionally changed). */
function series(patch: Partial<TeamSystem>, opponent: MatchTeam = OPPONENT): MatchResult[] {
  return playSeries(runningSystem(TEAM, patch), opponent, GAMES)
}

/** Share of a team's FGA of the given play types. */
function shotShare(results: MatchResult[], teamId: string, types: readonly PlayType[]): number {
  let part = 0
  let total = 0
  for (const r of results) {
    const [team] = sides(r, teamId)
    for (const type of PLAY_TYPES) total += team.shotsByPlayType[type].attempted
    for (const type of types) part += team.shotsByPlayType[type].attempted
  }
  return part / total
}

/** FG% of a team on the given play types. */
function shotPct(results: MatchResult[], teamId: string, types: readonly PlayType[]): number {
  let made = 0
  let attempted = 0
  for (const r of results) {
    const [team] = sides(r, teamId)
    for (const type of types) {
      made += team.shotsByPlayType[type].made
      attempted += team.shotsByPlayType[type].attempted
    }
  }
  return made / attempted
}

/** Total of a team-level result field over a series. */
function teamSum(
  results: MatchResult[],
  teamId: string,
  field: 'possessions' | 'fastBreakPoints' | 'points',
): number {
  return results.reduce((sum, r) => sum + sides(r, teamId)[0][field], 0)
}

/** Offensive rebounds as a share of all rebounds on the team's misses. */
function orbRate(results: MatchResult[], teamId: string, opponentId: string): number {
  const orb = seriesTotal(results, teamId, 'offensiveRebounds')
  return orb / (orb + seriesTotal(results, opponentId, 'defensiveRebounds'))
}

/** Share of a team's FGA taken by its busiest shooter in each game, averaged. */
function topShooterShare(results: MatchResult[], teamId: string): number {
  const shares = results.map((r) => {
    const players = sides(r, teamId)[0].players
    const total = players.reduce((s, l) => s + l.fieldGoalsAttempted, 0)
    return Math.max(...players.map((l) => l.fieldGoalsAttempted)) / total
  })
  return shares.reduce((s, v) => s + v, 0) / shares.length
}

const RIM: readonly PlayType[] = ['drive', 'cut', 'postUp']

describe('system settings move their levers', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  const base = series({})

  it('pace: fast plays more possessions, slow fewer', () => {
    const fast = teamSum(series({ pace: 'fast' }), 'home', 'possessions')
    const slow = teamSum(series({ pace: 'slow' }), 'home', 'possessions')
    const normal = teamSum(base, 'home', 'possessions')
    expect(fast / normal).toBeGreaterThan(1.02)
    expect(slow / normal).toBeLessThan(0.98)
  })

  it('shot profile: three-heavy takes more threes, inside-out fewer', () => {
    const normal = shotShare(base, 'home', ['three'])
    expect(shotShare(series({ shotProfile: 'threeHeavy' }), 'home', ['three'])).toBeGreaterThan(
      normal + 0.03,
    )
    expect(shotShare(series({ shotProfile: 'insideOut' }), 'home', ['three'])).toBeLessThan(
      normal - 0.03,
    )
  })

  it('primary action: post-ups post up more, off-ball cuts more, pick-and-roll posts less', () => {
    const post = shotShare(base, 'home', ['postUp'])
    const cut = shotShare(base, 'home', ['cut'])
    expect(shotShare(series({ primaryAction: 'postUps' }), 'home', ['postUp'])).toBeGreaterThan(
      post * 1.3,
    )
    expect(shotShare(series({ primaryAction: 'offBall' }), 'home', ['cut'])).toBeGreaterThan(
      cut * 1.2,
    )
    expect(shotShare(series({ primaryAction: 'pickAndRoll' }), 'home', ['postUp'])).toBeLessThan(
      post,
    )
  })

  it('ball movement: motion assists more and spreads shots, isolation the reverse', () => {
    /** Assists per made field goal. */
    const assistRate = (rs: MatchResult[]): number =>
      seriesTotal(rs, 'home', 'assists') / seriesTotal(rs, 'home', 'fieldGoalsMade')
    const motion = series({ ballMovement: 'motion' })
    const iso = series({ ballMovement: 'isolation' })
    // The assist rate sits near .61 league-wide, so motion has little room to rise: +0.01 is the
    // measurable effect over 60 games (it was +0.02 before rotations spread the minutes).
    expect(assistRate(motion)).toBeGreaterThan(assistRate(base) + 0.01)
    expect(assistRate(iso)).toBeLessThan(assistRate(base) - 0.02)
    expect(topShooterShare(iso, 'home')).toBeGreaterThan(topShooterShare(motion, 'home'))
    // The price of motion: more bad passes. The effect is small (about 2-3%), so it needs a longer
    // series than the other checks to stand out from game-to-game noise now that rotations
    // spread the minutes.
    const longMotion = playSeries(runningSystem(TEAM, { ballMovement: 'motion' }), OPPONENT, 300)
    const longIso = playSeries(runningSystem(TEAM, { ballMovement: 'isolation' }), OPPONENT, 300)
    expect(seriesTotal(longMotion, 'home', 'turnovers')).toBeGreaterThan(
      seriesTotal(longIso, 'home', 'turnovers'),
    )
  })

  it('transition: pushing scores more fast-break points, getting back fewer', () => {
    const normal = teamSum(base, 'home', 'fastBreakPoints')
    expect(teamSum(series({ transition: 'push' }), 'home', 'fastBreakPoints')).toBeGreaterThan(
      normal * 1.1,
    )
    expect(teamSum(series({ transition: 'getBack' }), 'home', 'fastBreakPoints')).toBeLessThan(
      normal * 0.9,
    )
  })

  it('offensive rebounding: crashing gets more boards but allows more fast breaks', () => {
    const crash = series({ offensiveRebounding: 'crash' })
    expect(orbRate(crash, 'home', 'away')).toBeGreaterThan(orbRate(base, 'home', 'away') + 0.02)
    expect(teamSum(crash, 'away', 'fastBreakPoints')).toBeGreaterThan(
      teamSum(base, 'away', 'fastBreakPoints'),
    )
    const back = series({ offensiveRebounding: 'getBack' })
    // Measured (300 games): ORB% .249 balanced, .225 get back, .327 crash.
    expect(orbRate(back, 'home', 'away')).toBeLessThan(orbRate(base, 'home', 'away') - 0.01)
  })

  it('pressure: aggressive forces turnovers and steals but fouls more', () => {
    const aggressive = series({ defensivePressure: 'aggressive' })
    const conservative = series({ defensivePressure: 'conservative' })
    expect(seriesTotal(aggressive, 'away', 'turnovers')).toBeGreaterThan(
      seriesTotal(base, 'away', 'turnovers') * 1.05,
    )
    expect(seriesTotal(aggressive, 'home', 'steals')).toBeGreaterThan(
      seriesTotal(base, 'home', 'steals') * 1.1,
    )
    expect(seriesTotal(aggressive, 'home', 'personalFouls')).toBeGreaterThan(
      seriesTotal(base, 'home', 'personalFouls'),
    )
    expect(seriesTotal(conservative, 'away', 'turnovers')).toBeLessThan(
      seriesTotal(base, 'away', 'turnovers'),
    )
    expect(seriesTotal(conservative, 'home', 'personalFouls')).toBeLessThan(
      seriesTotal(base, 'home', 'personalFouls'),
    )
  })

  it('help priority: protecting the paint trades rim makes for open threes', () => {
    const paint = series({ helpPriority: 'protectPaint' })
    const shooters = series({ helpPriority: 'runShooters' })
    expect(shotPct(paint, 'away', RIM)).toBeLessThan(shotPct(shooters, 'away', RIM))
    expect(shotPct(paint, 'away', ['three'])).toBeGreaterThan(shotPct(shooters, 'away', ['three']))
  })

  it('execution edges help the coached team at each end', () => {
    /** The home team with execution edges. */
    const coached = (offense: number, defense: number): MatchResult[] =>
      playSeries(
        {
          ...TEAM,
          coaching: {
            system: BALANCED_SYSTEM,
            offensiveExecution: offense,
            defensiveExecution: defense,
          },
        },
        OPPONENT,
        GAMES,
      )
    expect(teamSum(coached(0.2, 0), 'home', 'points')).toBeGreaterThan(
      teamSum(base, 'home', 'points'),
    )
    expect(teamSum(coached(0, 0.2), 'away', 'points')).toBeLessThan(teamSum(base, 'away', 'points'))
  })
})

describe('systems keep the engine deterministic and CA-blind', () => {
  it('plays the identical game for the same seed with systems and coaching', () => {
    const home = {
      ...TEAM,
      coaching: {
        system: archetypeSystem('paceAndSpace'),
        offensiveExecution: 0.02,
        defensiveExecution: -0.01,
      },
    }
    const away = runningSystem(OPPONENT, archetypeSystem('gritAndGrind'))
    const first = simulateGame({ home, away, rules: PRO_RULES, seed: 9 })
    expect(simulateGame({ home, away, rules: PRO_RULES, seed: 9 })).toEqual(first)
  })

  it('ignores CA and Potential even when fit applies', () => {
    const system = archetypeSystem('smallBall')
    const home = runningSystem(TEAM, system)
    const scrambled: MatchTeam = {
      ...home,
      roster: home.roster.map((p, i) => ({
        ...p,
        hidden: { ...p.hidden, currentAbility: 1 + i, potential: 99 - i },
      })),
    }
    const away = runningSystem(OPPONENT, archetypeSystem('starDriven'))
    // The coach may use CA when choosing minutes, so pin the rotation: same lineups and minutes
    // must give the same game whatever the hidden CA/Potential say.
    const rotation = buildRotationPlan(home.roster, undefined, system)
    expect(
      simulateGame({ home: { ...scrambled, rotation }, away, rules: PRO_RULES, seed: 4 }),
    ).toEqual(simulateGame({ home: { ...home, rotation }, away, rules: PRO_RULES, seed: 4 }))
  })
})
