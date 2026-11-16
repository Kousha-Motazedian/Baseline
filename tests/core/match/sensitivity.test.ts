/**
 * Statistical monotonicity tests: raising an attribute must move the stat it drives, in the right
 * direction. Every series is seeded (so results are reproducible) and compares the same matchup
 * with one change, on the same game seeds. Effects measured while writing these were 2–5x the
 * thresholds used, so the tests aren't sitting on a knife edge.
 */
import { describe, expect, it } from 'vitest'
import type { ShotContext } from '../../../src/core/match/shot.ts'
import { makeChance } from '../../../src/core/match/shot.ts'
import type { MatchResult, MatchTeam } from '../../../src/core/match/types.ts'
import { PLAY_TYPES } from '../../../src/core/match/types.ts'
import type { Player } from '../../../src/core/players/types.ts'
import {
  generatedPair,
  makeFlatTeam,
  patchTeam,
  updatePlayer,
  withAttributes,
  withConsistency,
} from '../../helpers/fixtures.ts'
import { makeGameState, withRosterStarters } from '../../helpers/gameState.ts'
import {
  playerTotal,
  playSeries,
  seriesTotal,
  sides,
  SLOW_TEST_TIMEOUT_MS,
  standardDeviation,
} from '../../helpers/simulation.ts'

/** Games per series: 60 games ≈ 5,000 FGA per team, enough for the effect sizes below. */
const GAMES = 60

/** The base matchup every test perturbs: two generated average teams (ids "home"/"away"). */
const [TEAM, OPPONENT] = generatedPair(51)

/** Ratio of two series totals for one team, e.g. made / attempted. */
function rate(
  results: MatchResult[],
  teamId: string,
  num: Parameters<typeof seriesTotal>[2],
  den: Parameters<typeof seriesTotal>[2],
): number {
  return seriesTotal(results, teamId, num) / seriesTotal(results, teamId, den)
}

/** Share of a team's field goal attempts that are drives or cuts (shots attacking the rim). */
function rimAttackShare(results: MatchResult[], teamId: string): number {
  let rim = 0
  let total = 0
  for (const r of results) {
    const [team] = sides(r, teamId)
    for (const type of PLAY_TYPES) total += team.shotsByPlayType[type].attempted
    rim += team.shotsByPlayType.drive.attempted + team.shotsByPlayType.cut.attempted
  }
  return rim / total
}

/** Runs the base matchup with the home team and/or the opponent modified. */
function series(team: MatchTeam = TEAM, opponent: MatchTeam = OPPONENT): MatchResult[] {
  return playSeries(team, opponent, GAMES)
}

describe('shooting attributes', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('raising Three-Point raises a player’s 3PA share and 3P%', () => {
    const id = TEAM.roster[2]?.id ?? ''
    /** The player's share of team 3PA and his 3P% at a given Three-Point rating. */
    const at = (rating: number): { share: number; pct: number } => {
      const rs = series(updatePlayer(TEAM, 2, (p) => withAttributes(p, { threePoint: rating })))
      const tpa = playerTotal(rs, 'home', id, 'threesAttempted')
      return {
        share: tpa / playerTotal(rs, 'home', id, 'fieldGoalsAttempted'),
        pct: playerTotal(rs, 'home', id, 'threesMade') / tpa,
      }
    }
    const low = at(6)
    const high = at(18)
    // Measured: share .16 → .74, 3P% .24 → .44.
    expect(high.share - low.share).toBeGreaterThan(0.3)
    expect(high.pct - low.pct).toBeGreaterThan(0.08)
  })

  it('raising Free Throw raises FT%', () => {
    const low = rate(
      series(patchTeam(TEAM, { freeThrow: 6 })),
      'home',
      'freeThrowsMade',
      'freeThrowsAttempted',
    )
    const high = rate(
      series(patchTeam(TEAM, { freeThrow: 18 })),
      'home',
      'freeThrowsMade',
      'freeThrowsAttempted',
    )
    // Linear model predicts .70 → .92; ±0.03 covers sampling noise over ~1,500 FTA.
    expect(high - low).toBeGreaterThan(0.17)
  })

  it('raising Aggression draws more free throws', () => {
    const low = seriesTotal(
      series(patchTeam(TEAM, { aggression: 4 })),
      'home',
      'freeThrowsAttempted',
    )
    const high = seriesTotal(
      series(patchTeam(TEAM, { aggression: 18 })),
      'home',
      'freeThrowsAttempted',
    )
    expect(high / low).toBeGreaterThan(1.4)
  })
})

/**
 * The opponent with its roster-slot-4 big's Shot Blocking set to `rating`, starting him. The
 * coach picks starters by value and position, so without the pin a Shot Blocking change could
 * demote the big to the bench and the test would measure rotation instead of the attribute.
 */
function pinnedBig(rating: number): MatchTeam {
  return withRosterStarters(
    updatePlayer(OPPONENT, 4, (p) => withAttributes(p, { shotBlocking: rating })),
  )
}

describe('defensive attributes', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('raising a big’s Shot Blocking raises his team’s blocks', () => {
    const low = seriesTotal(series(TEAM, pinnedBig(3)), 'away', 'blocks')
    const high = seriesTotal(series(TEAM, pinnedBig(20)), 'away', 'blocks')
    // Measured 3.5 → 5.8 per game when he played all 48 minutes; with rotations he plays about 2/3
    // of the game (about 1.18 with the stub rotation).
    expect(high / low).toBeGreaterThan(1.1)
  })

  it('a strong rim protector cuts the opponent’s share of drives and cuts', () => {
    /** The opponent with its big's rim-protection attributes set to `rating`. */
    const rim = (rating: number): MatchTeam =>
      updatePlayer(OPPONENT, 4, (p) =>
        withAttributes(p, { interiorDefense: rating, vertical: rating, shotBlocking: rating }),
      )
    const weak = rimAttackShare(series(TEAM, rim(4)), 'home')
    const strong = rimAttackShare(series(TEAM, rim(20)), 'home')
    // Measured .30 → .18 with the old archetype generator; with position-based average teams
    // −.06 to −.11 across base-pair seeds 51–55 (−.06 for this pair), 60-game noise ≈ ±.01.
    expect(weak - strong).toBeGreaterThan(0.04)
  })

  it('raising Stealing produces more steals and more opponent turnovers', () => {
    const low = series(TEAM, patchTeam(OPPONENT, { stealing: 6 }))
    const high = series(TEAM, patchTeam(OPPONENT, { stealing: 18 }))
    expect(seriesTotal(high, 'away', 'steals')).toBeGreaterThan(
      1.8 * seriesTotal(low, 'away', 'steals'),
    )
    expect(seriesTotal(high, 'home', 'turnovers')).toBeGreaterThan(
      seriesTotal(low, 'home', 'turnovers'),
    )
  })

  it('raising Discipline means fewer personal fouls', () => {
    const low = seriesTotal(
      series(TEAM, patchTeam(OPPONENT, { discipline: 4 })),
      'away',
      'personalFouls',
    )
    const high = seriesTotal(
      series(TEAM, patchTeam(OPPONENT, { discipline: 18 })),
      'away',
      'personalFouls',
    )
    expect(high / low).toBeLessThan(0.7)
  })
})

describe('playmaking and rebounding attributes', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('raising Ball Handling reduces turnovers', () => {
    const low = seriesTotal(series(patchTeam(TEAM, { ballHandling: 6 })), 'home', 'turnovers')
    const high = seriesTotal(series(patchTeam(TEAM, { ballHandling: 18 })), 'home', 'turnovers')
    // Measured 14.7 → 9.7 per game.
    expect(high / low).toBeLessThan(0.8)
  })

  it('raising Passing raises the share of made shots that are assisted', () => {
    const low = rate(series(patchTeam(TEAM, { passing: 5 })), 'home', 'assists', 'fieldGoalsMade')
    const high = rate(series(patchTeam(TEAM, { passing: 18 })), 'home', 'assists', 'fieldGoalsMade')
    // Measured +.04 to +.06 across base-pair seeds 51–55 with the position-based generator
    // (+.06 to +.07 with the old archetype one); 60-game noise is about ±.01.
    expect(high - low).toBeGreaterThan(0.025)
  })

  it('raising Offensive Rebounding raises ORB%', () => {
    /** The 'home'-id team's offensive-rebound percentage over a series. */
    const orbPct = (rs: MatchResult[]): number => {
      const orb = seriesTotal(rs, 'home', 'offensiveRebounds')
      return orb / (orb + seriesTotal(rs, 'away', 'defensiveRebounds'))
    }
    // Measured .21 → .34.
    expect(orbPct(series(patchTeam(TEAM, { offensiveRebounding: 18 })))).toBeGreaterThan(
      orbPct(series(patchTeam(TEAM, { offensiveRebounding: 5 }))) + 0.07,
    )
  })
})

describe('Consistency (game-day form)', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  /** Spread of one fixed shot's make chance across many tip-offs (each rolls fresh form). */
  function makeChanceSpread(consistency: number): number {
    const home = withConsistency(makeFlatTeam('A', 10.5), consistency)
    const away = withConsistency(makeFlatTeam('B', 10.5), 20)
    const chances = Array.from({ length: 400 }, (_, seed) => {
      const game = makeGameState({ home, away, seed })
      const shooter = game.home.onCourt[0] as Player
      const contesters = {
        defender: game.away.onCourt[0] as Player,
        rimProtector: game.away.onCourt[4] as Player,
      }
      const ctx: ShotContext = {
        game,
        offense: game.home,
        defense: game.away,
        shooter,
        contesters,
        playType: 'three',
      }
      return makeChance(ctx)
    })
    return standardDeviation(chances)
  }

  it('makes an inconsistent shooter’s game-to-game make chance swing far more', () => {
    // Defenders are held at Consistency 20 (near-zero swing), so the spread is the shooter's form.
    expect(makeChanceSpread(1)).toBeGreaterThan(3 * makeChanceSpread(20))
  })
})

describe('shot distribution', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  /** 100 unmodified games, shared by the usage and rebound checks. */
  const results = playSeries(TEAM, OPPONENT, 100)

  it('caps usage: no starter averages more than a third of his team’s shots', () => {
    for (const player of TEAM.roster.slice(0, 5)) {
      const share =
        playerTotal(results, 'home', player.id, 'fieldGoalsAttempted') /
        seriesTotal(results, 'home', 'fieldGoalsAttempted')
      expect(share).toBeLessThan(1 / 3)
      expect(share).toBeGreaterThan(0.08)
    }
  })

  it('spreads rebounds: the starting big gets the most, but well under half', () => {
    /** A player's total rebounds over the series. */
    const reb = (id: string): number =>
      playerTotal(results, 'home', id, 'offensiveRebounds') +
      playerTotal(results, 'home', id, 'defensiveRebounds')
    const shares = TEAM.roster.slice(0, 5).map((p) => reb(p.id))
    const total = shares.reduce((s, x) => s + x, 0)
    const bigShare = (shares[4] ?? 0) / total
    // Real starting centers take ~25–35% of their team's boards; measured ≈ .31.
    expect(bigShare).toBeGreaterThan(0.22)
    expect(bigShare).toBeLessThan(0.4)
    expect(Math.max(...shares)).toBe(shares[4])
  })
})
