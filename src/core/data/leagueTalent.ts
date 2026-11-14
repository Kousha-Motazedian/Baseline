import type { Rng } from '../shared/rng.ts'

/**
 * League talent pool: how many players of each Current Ability tier a generated league has, and
 * how that talent is dealt out to teams. Only CA numbers live here; the players themselves are
 * built to these targets by playerGenerator.ts. Targets: docs/design/player-roles.md, section 3.
 */

/**
 * The league size the tier counts below are written for. Roster size comes from the league rules
 * (LeagueRules.rosterSize; 30 pro teams × 15 = the doc's ~450-player league): the counted tiers
 * are about the league's best players, so a smaller roster only shrinks the fringe band.
 */
export const REFERENCE_TEAMS = 30

/** One tier band: its CA range and how many players a reference league gets. */
interface TierBand {
  minCa: number
  maxCa: number
  /** Draws how many players a 30-team league has in this band. */
  count: (rng: Rng) => number
  /**
   * Skew of CA within the band: a uniform draw u is turned into u^skew, so skew > 1 piles players
   * towards the bottom of the band (talent thins out as ability rises, inside a band too) and
   * skew < 1 towards the top.
   */
  skew: number
}

/**
 * GOAT count for a reference league: 0 in about 78%, 1 in about 20%, 2 in about 2%, never more.
 * Drawn per league (not per player) so "never more than 2" holds exactly instead of being a rare
 * tail of independent rolls.
 */
function goatCount(rng: Rng): number {
  const roll = rng.next()
  if (roll < 0.02) return 2
  if (roll < 0.22) return 1
  return 0
}

/**
 * The counted bands, best first, with a count drawn per league. Count ranges sit inside the doc's
 * targets (a little narrower for All-Star, Quality starter and Rotation, so every league lands in
 * band). Fringe players (FRINGE_BAND) then fill every remaining roster spot.
 */
const COUNTED_BANDS: readonly TierBand[] = [
  { minCa: 100, maxCa: 100, count: goatCount, skew: 1 },
  { minCa: 90, maxCa: 99, count: (rng) => rng.nextInt(1, 3), skew: 1.5 },
  { minCa: 80, maxCa: 89, count: (rng) => rng.nextInt(5, 8), skew: 1.3 },
  { minCa: 70, maxCa: 79, count: (rng) => rng.nextInt(21, 29), skew: 1.3 },
  { minCa: 60, maxCa: 69, count: (rng) => rng.nextInt(95, 115), skew: 1.2 },
  { minCa: 50, maxCa: 59, count: (rng) => rng.nextInt(155, 175), skew: 1 },
]

/**
 * The bottom band: end of bench / fringe players fill every remaining roster spot. Its skew is
 * below 1, which piles players towards the TOP of the band instead: the fringe of a top league is
 * mostly players just short of rotation level, with only a few true 40s.
 */
const FRINGE_BAND = { minCa: 40, maxCa: 49, skew: 0.8 }

/** Draws one CA inside a band, skewed towards its bottom or top (see TierBand.skew). */
function drawInBand(rng: Rng, minCa: number, maxCa: number, skew: number): number {
  const span = maxCa - minCa + 1
  return Math.min(maxCa, minCa + Math.floor(rng.next() ** skew * span))
}

/** Draws `count` CAs inside a band. */
function drawBand(rng: Rng, count: number, minCa: number, maxCa: number, skew: number): number[] {
  return Array.from({ length: count }, () => drawInBand(rng, minCa, maxCa, skew))
}

/**
 * CA targets for every rostered player of a league with `teams` teams of `rosterSize`, best first.
 * Band counts are drawn for a 30-team league and scaled linearly for bigger leagues (rounded);
 * smaller leagues use the 30-team pool and only realise some of its teams (see teamGenerator.ts).
 * If the counted bands alone overflow the league (tiny rosters), its lowest players are dropped.
 */
export function drawLeagueAbilities(rng: Rng, teams: number, rosterSize: number): number[] {
  const poolTeams = Math.max(teams, REFERENCE_TEAMS)
  const total = poolTeams * rosterSize
  const abilities: number[] = []
  for (const band of COUNTED_BANDS) {
    const count = Math.round((band.count(rng) * poolTeams) / REFERENCE_TEAMS)
    abilities.push(...drawBand(rng, count, band.minCa, band.maxCa, band.skew))
  }
  const fringe = Math.max(0, total - abilities.length)
  abilities.push(...drawBand(rng, fringe, FRINGE_BAND.minCa, FRINGE_BAND.maxCa, FRINGE_BAND.skew))
  return abilities.sort((a, b) => b - a).slice(0, total)
}

/** A random permutation of 0..n−1 (Fisher–Yates). */
export function shuffledIndices(rng: Rng, n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = rng.nextInt(0, i)
    ;[order[i], order[j]] = [order[j] as number, order[i] as number]
  }
  return order
}

/**
 * Deals a best-first CA list into rosters. The list is cut into "rounds" of one player per team
 * (the 30 best, the next 30, ...), and each round goes to the teams in a fresh random order. So
 * every team gets exactly one player from each talent round: one of the league's top 30 (its
 * star), one of the next 30, and so on. Why: a fully random deal gives some teams three superstars
 * and others none, a far wider team-quality spread than a real league (where the draft, cap and
 * trades even things out); a strict snake draft would make every team identical in total talent.
 */
export function dealRosters(rng: Rng, abilities: readonly number[], teams: number): number[][] {
  const rosters: number[][] = Array.from({ length: teams }, () => [])
  for (let start = 0; start + teams <= abilities.length; start += teams) {
    const order = shuffledIndices(rng, teams)
    order.forEach((team, k) => rosters[team]?.push(abilities[start + k] as number))
  }
  return rosters
}
