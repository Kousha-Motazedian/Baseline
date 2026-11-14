/**
 * Inspects generated leagues, to check the Current Ability calibration, positions and roles.
 *
 *   npm run inspect:league                      one 30-team league (seed 1) in detail
 *   npm run inspect:league -- --seed 42         a different league
 *   npm run inspect:league -- --leagues 500     also summarise 500 leagues (tiers, GOAT frequency)
 *
 * Targets: docs/design/player-roles.md, section 3.
 */
import { generateLeague } from '../src/core/data/teamGenerator.ts'
import { VISIBLE_ATTRIBUTE_KEYS } from '../src/core/players/attributes.ts'
import type { CaTier } from '../src/core/players/currentAbility.ts'
import { CA_TIERS, caTier, currentAbility } from '../src/core/players/currentAbility.ts'
import type { Position } from '../src/core/players/positions.ts'
import {
  formatPositions,
  POSITIONS,
  positionRatings,
  positionsPlayed,
  primaryPosition,
} from '../src/core/players/positions.ts'
import type { RoleName } from '../src/core/players/roles.ts'
import { playerRoles, ROLE_NAMES } from '../src/core/players/roles.ts'
import type { Player } from '../src/core/players/types.ts'
import { fullName } from '../src/core/players/types.ts'
import { createRng } from '../src/core/shared/rng.ts'

/** Teams in an inspected league. */
const TEAMS = 30

/** Everything the report needs about one player, computed once. */
interface PlayerSummary {
  player: Player
  team: string
  ca: number
  tier: CaTier
  primary: Position
  played: Position[]
  roles: RoleName[]
  meanAttribute: number
}

/** Mean of all 30 visible attributes (for checking what each tier looks like on the 1–20 scale). */
function meanAttribute(player: Player): number {
  const sum = VISIBLE_ATTRIBUTE_KEYS.reduce((total, key) => total + player.attributes[key], 0)
  return sum / VISIBLE_ATTRIBUTE_KEYS.length
}

/** Computes a player's CA, tier, positions and roles. */
function summarise(player: Player, team: string): PlayerSummary {
  const ratings = positionRatings(player)
  const ca = currentAbility(player)
  return {
    player,
    team,
    ca,
    tier: caTier(ca),
    primary: primaryPosition(ratings),
    played: positionsPlayed(ratings),
    roles: playerRoles(player, ca),
    meanAttribute: meanAttribute(player),
  }
}

/** Generates one league and summarises every player. */
function inspectLeague(seed: number): PlayerSummary[] {
  return generateLeague(createRng(seed), TEAMS).flatMap((team) =>
    team.roster.map((player) => summarise(player, team.name)),
  )
}

/** Counts how often each key occurs. */
function countBy<K extends string>(items: readonly K[]): Map<K, number> {
  const counts = new Map<K, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

/** Prints the tier table: player count, mean visible attribute and the share with two roles. */
function printTiers(players: readonly PlayerSummary[]): void {
  console.log(
    `\n${'Tier'.padEnd(20)} ${'Players'.padStart(7)} ${'Mean attr'.padStart(10)} ${'2 roles'.padStart(8)}`,
  )
  for (const { name } of CA_TIERS) {
    const inTier = players.filter((p) => p.tier === name)
    if (inTier.length === 0) continue
    const mean = inTier.reduce((s, p) => s + p.meanAttribute, 0) / inTier.length
    const twoRoles = inTier.filter((p) => p.roles.length === 2).length
    console.log(
      `${name.padEnd(20)} ${String(inTier.length).padStart(7)} ${mean.toFixed(2).padStart(10)} ${String(twoRoles).padStart(8)}`,
    )
  }
}

/** Prints primary positions, multi-position players, and how often each role is held. */
function printPositionsAndRoles(players: readonly PlayerSummary[]): void {
  const primaries = countBy(players.map((p) => p.primary))
  console.log(
    `\nPrimary positions: ${POSITIONS.map((p) => `${p} ${primaries.get(p) ?? 0}`).join(', ')}`,
  )
  const playing = (n: number): number => players.filter((p) => p.played.length === n).length
  const threePlus = players.length - playing(1) - playing(2)
  console.log(`Positions played: 1 = ${playing(1)}, 2 = ${playing(2)}, 3+ = ${threePlus}`)
  const roles = countBy(players.flatMap((p) => p.roles))
  console.log('\nRoles held (a two-role player counts in both):')
  for (const role of ROLE_NAMES) console.log(`  ${role.padEnd(20)} ${roles.get(role) ?? 0}`)
}

/** Prints the league's best players. */
function printTopPlayers(players: readonly PlayerSummary[], count: number): void {
  console.log(`\nTop ${count} players`)
  const top = [...players].sort((a, b) => b.ca - a.ca).slice(0, count)
  for (const p of top) {
    const height = `${p.player.measurables.heightCm} cm`
    console.log(
      `  ${String(p.ca).padStart(3)}  ${fullName(p.player).padEnd(22)} ${formatPositions(p.played).padEnd(10)} ${height.padEnd(7)} ${p.roles.join(' + ')}`,
    )
  }
}

/** Generates many leagues and prints mean tier counts, GOAT frequency and superstar second roles. */
function printManyLeagues(leagues: number, seed: number): void {
  const tierTotals = new Map<CaTier, number>()
  const goatLeagues = new Map<number, number>()
  let superstars = 0
  let superstarsWithTwo = 0
  for (let i = 0; i < leagues; i++) {
    const players = inspectLeague(seed * 1_000_003 + i)
    for (const [tier, n] of countBy(players.map((p) => p.tier))) {
      tierTotals.set(tier, (tierTotals.get(tier) ?? 0) + n)
    }
    const goats = players.filter((p) => p.tier === 'GOAT').length
    goatLeagues.set(goats, (goatLeagues.get(goats) ?? 0) + 1)
    const stars = players.filter((p) => p.tier === 'Superstar')
    superstars += stars.length
    superstarsWithTwo += stars.filter((p) => p.roles.length === 2).length
  }
  console.log(`\n${leagues} leagues: mean players per tier`)
  for (const { name } of CA_TIERS) {
    const total = tierTotals.get(name) ?? 0
    if (total > 0) console.log(`  ${name.padEnd(20)} ${(total / leagues).toFixed(2).padStart(7)}`)
  }
  console.log('GOATs per league:')
  for (const goats of [...goatLeagues.keys()].sort((a, b) => a - b)) {
    const share = ((goatLeagues.get(goats) ?? 0) / leagues) * 100
    console.log(`  ${goats}: ${share.toFixed(1)}% of leagues`)
  }
  const share = superstars === 0 ? 0 : (superstarsWithTwo / superstars) * 100
  console.log(
    `Superstars with 2 roles: ${share.toFixed(1)}% (${superstarsWithTwo} of ${superstars})`,
  )
}

/** Reads a numeric `--name value` command-line option, or returns the fallback. */
function numberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isFinite(value)) throw new Error(`--${name} needs a number`)
  return value
}

/** Entry point: one league in detail and, with --leagues N, a summary over N leagues. */
function main(): void {
  const seed = numberArg('seed', 1)
  const players = inspectLeague(seed)
  console.log(`League seed ${seed}: ${TEAMS} teams, ${players.length} players`)
  printTiers(players)
  printPositionsAndRoles(players)
  printTopPlayers(players, 15)
  const leagues = numberArg('leagues', 0)
  if (leagues > 0) printManyLeagues(leagues, seed)
}

main()
