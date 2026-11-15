/**
 * Team systems in the match engine: the no-coaching / balanced-system identity, determinism, and
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
import { archetypeSystem, BALANCED_SYSTEM } from '../../../src/core/tactics/system.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { runningSystem, systemOnly } from '../../helpers/coaching.ts'
import { generatedPair } from '../../helpers/fixtures.ts'
import { playSeries, seriesTotal, sides, SLOW_TEST_TIMEOUT_MS } from '../../helpers/simulation.ts'

/**
 * SHA-256 of 40 fixed-seed games (league teams, every 4th under FIBA rules) produced by the engine
 * BEFORE team systems existed (commit d9c858b, this branch's parent of the coaches change). The
 * engine must still reproduce it exactly with no coaching, and with the balanced system at zero
 * execution edges.
 */
const PRE_SYSTEMS_HASH = '730b31885f93233ee9737bbe9bc1182b20349daff05a115c1264c7bfbfa23e32'

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

describe('balanced-system identity', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('reproduces the pre-systems engine byte for byte without coaching', () => {
    expect(goldenHash(undefined)).toBe(PRE_SYSTEMS_HASH)
  })

  it('reproduces it byte for byte with the balanced system and zero execution edges', () => {
    expect(goldenHash(systemOnly(BALANCED_SYSTEM))).toBe(PRE_SYSTEMS_HASH)
  })

  it('reproduces it when only the rotation settings change (no engine effect yet)', () => {
    const rotation = {
      ...BALANCED_SYSTEM,
      rotationDepth: 'deep' as const,
      starterMinutes: 'share' as const,
    }
    expect(goldenHash(systemOnly(rotation))).toBe(PRE_SYSTEMS_HASH)
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
    expect(assistRate(motion)).toBeGreaterThan(assistRate(base) + 0.02)
    expect(assistRate(iso)).toBeLessThan(assistRate(base) - 0.02)
    expect(topShooterShare(iso, 'home')).toBeGreaterThan(topShooterShare(motion, 'home'))
    // The price of motion: more bad passes.
    expect(seriesTotal(motion, 'home', 'turnovers')).toBeGreaterThan(
      seriesTotal(iso, 'home', 'turnovers'),
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
    expect(simulateGame({ home: scrambled, away, rules: PRO_RULES, seed: 4 })).toEqual(
      simulateGame({ home, away, rules: PRO_RULES, seed: 4 }),
    )
  })
})
