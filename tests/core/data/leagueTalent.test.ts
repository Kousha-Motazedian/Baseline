import { describe, expect, it } from 'vitest'
import {
  dealRosters,
  drawLeagueAbilities,
  REFERENCE_TEAMS,
} from '../../../src/core/data/leagueTalent.ts'
import { generateLeague } from '../../../src/core/data/teamGenerator.ts'
import type { CaTier } from '../../../src/core/players/currentAbility.ts'
import { caTier } from '../../../src/core/players/currentAbility.ts'
import { playerRoles } from '../../../src/core/players/roles.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { PRO_RULES } from '../../../src/core/world/rules.ts'

/** Players per pro roster. */
const ROSTER_SIZE = PRO_RULES.rosterSize

/** Counts how many CAs fall in each tier. */
function tierCounts(abilities: readonly number[]): Map<CaTier, number> {
  const counts = new Map<CaTier, number>()
  for (const ca of abilities) counts.set(caTier(ca), (counts.get(caTier(ca)) ?? 0) + 1)
  return counts
}

/** Tier targets for a 30-team league from docs/design/player-roles.md (inclusive). */
const TIER_TARGETS: readonly [CaTier, number, number][] = [
  ['GOAT', 0, 2],
  ['Generational', 1, 3],
  ['Superstar', 5, 8],
  ['All-Star', 20, 30],
  ['Quality starter', 90, 120],
  ['Rotation player', 150, 180],
]

describe('drawLeagueAbilities', () => {
  it('draws a full, best-first league of top-league players', () => {
    const abilities = drawLeagueAbilities(createRng(1), 30, ROSTER_SIZE)
    expect(abilities).toHaveLength(REFERENCE_TEAMS * ROSTER_SIZE)
    for (let i = 1; i < abilities.length; i++) {
      expect(abilities[i]).toBeLessThanOrEqual(abilities[i - 1] as number)
    }
    expect(Math.min(...abilities)).toBeGreaterThanOrEqual(40)
    expect(Math.max(...abilities)).toBeLessThanOrEqual(100)
  })

  it('keeps every tier inside its target band in every league', () => {
    const rng = createRng(2)
    for (let league = 0; league < 500; league++) {
      const counts = tierCounts(drawLeagueAbilities(rng, 30, ROSTER_SIZE))
      for (const [tier, min, max] of TIER_TARGETS) {
        const n = counts.get(tier) ?? 0
        expect(n).toBeGreaterThanOrEqual(min)
        expect(n).toBeLessThanOrEqual(max)
      }
    }
  })

  it('has no GOAT in most leagues, one in about 20%, two in at most ~2%, never more', () => {
    const rng = createRng(3)
    const leagues = 5000
    const byCount = [0, 0, 0]
    for (let league = 0; league < leagues; league++) {
      const goats = drawLeagueAbilities(rng, 30, ROSTER_SIZE).filter((ca) => ca === 100).length
      expect(goats).toBeLessThanOrEqual(2)
      byCount[goats] = (byCount[goats] ?? 0) + 1
    }
    // 5,000 leagues: the SE of a ~20% share is ≈ 0.6 points, so these bands are ~5 SE wide.
    expect((byCount[0] as number) / leagues).toBeGreaterThan(0.75)
    expect((byCount[0] as number) / leagues).toBeLessThan(0.81)
    expect((byCount[1] as number) / leagues).toBeGreaterThan(0.17)
    expect((byCount[1] as number) / leagues).toBeLessThan(0.23)
    expect((byCount[2] as number) / leagues).toBeLessThan(0.03)
  })
})

describe('dealRosters', () => {
  it('gives every team one player from each talent round', () => {
    const abilities = drawLeagueAbilities(createRng(4), 30, ROSTER_SIZE)
    const rosters = dealRosters(createRng(5), abilities, 30)
    expect(rosters).toHaveLength(30)
    for (const roster of rosters) {
      expect(roster).toHaveLength(ROSTER_SIZE)
      // A team's k-th best player comes from round k: ranks 30k..30k+29 of the league.
      roster.forEach((ca, round) => {
        expect(ca).toBeLessThanOrEqual(abilities[round * 30] as number)
        expect(ca).toBeGreaterThanOrEqual(abilities[round * 30 + 29] as number)
      })
    }
  })
})

describe('generated leagues (computed CA, positions and roles)', () => {
  // Full player generation is slower, so fewer leagues: 40 × 450 players.
  const leagues = Array.from({ length: 40 }, (_, i) =>
    generateLeague(createRng(1000 + i), 30).flatMap((t) => t.roster),
  )

  it('hits the tier bands exactly with computed CA (every player is built to his target)', () => {
    for (const players of leagues) {
      const counts = tierCounts(players.map((p) => p.hidden.currentAbility))
      for (const [tier, min, max] of TIER_TARGETS) {
        const n = counts.get(tier) ?? 0
        expect(n).toBeGreaterThanOrEqual(min)
        expect(n).toBeLessThanOrEqual(max)
      }
    }
  })

  it('gives Generational and GOAT players two roles, about 10% of superstars two, others one', () => {
    let superstars = 0
    let superstarsWithTwo = 0
    for (const players of leagues) {
      for (const p of players) {
        const ca = p.hidden.currentAbility
        const count = playerRoles(p, ca).length
        if (ca >= 90) expect(count).toBe(2)
        else if (ca < 80) expect(count).toBe(1)
        else {
          superstars++
          if (count === 2) superstarsWithTwo++
        }
      }
    }
    // ≈ 260 superstars: SE of a 10% share ≈ 1.9 points, so 3–20% is a safe band.
    const share = superstarsWithTwo / superstars
    expect(share).toBeGreaterThan(0.03)
    expect(share).toBeLessThan(0.2)
  })
})
