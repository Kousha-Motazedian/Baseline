import type { MatchTeam } from '../match/types.ts'
import type { Position } from '../players/positions.ts'
import { POSITIONS } from '../players/positions.ts'
import { randomNormal } from '../shared/normal.ts'
import { clamp } from '../shared/probability.ts'
import type { Rng } from '../shared/rng.ts'
import type { LeagueRules } from '../world/rules.ts'
import { PRO_RULES } from '../world/rules.ts'
import {
  dealRosters,
  drawLeagueAbilities,
  REFERENCE_TEAMS,
  shuffledIndices,
} from './leagueTalent.ts'
import { TEAM_NAMES } from './names.ts'
import { generatePlayer } from './playerGenerator.ts'

/**
 * Team generation. A league team is dealt a realistic spread of Current Ability (one of the league's
 * 30 best players, one of the next 30, and so on; see leagueTalent.ts) and three players per
 * position (with 15-man rosters). The roster is ordered so the match engine's slot-for-slot matchups work: the five
 * starters come first in PG, SG, SF, PF, C order, then the bench in the same order.
 */

/** What the caller controls when generating a team. */
export interface TeamGenerationOptions {
  id: string
  /** Team name; a random fictional one is picked if omitted. */
  name?: string
  /**
   * Build a uniform "average" team instead of a realistic league team: every starter is built to
   * about this CA and the bench a little lower, with no stars. Used where a test needs evenly
   * matched teams of a known quality (see AVERAGE_TEAM_CA).
   */
  averageCa?: number
  /** League rules; only the roster size is used. Defaults to PRO_RULES (15 players). */
  rules?: LeagueRules
}

/** One roster spot to fill: the position and the CA the player is built to. */
interface RosterSpot {
  position: Position
  targetCa: number
}

/**
 * CA of an average team's starters. Chosen so their mean visible rating sits near the match
 * engine's 10.5 reference, matching the old generator's average team (quality 10.5); see
 * player-roles.md "Calibration results".
 */
export const AVERAGE_TEAM_CA = 67
/** How much weaker an average team's bench is than its starters, in CA. */
const AVERAGE_BENCH_CA_DROP = 12
/** Spread of each player's CA around an average team's level (some are simply better). */
const AVERAGE_TEAM_CA_SD = 7

/** Players per position group: the starters, then each bench unit. */
const UNIT = POSITIONS.length

/** A random permutation of the five positions. */
function shuffledPositions(rng: Rng): Position[] {
  return shuffledIndices(rng, UNIT).map((i) => POSITIONS[i] as Position)
}

/**
 * Roster spots for a best-first list of CAs. Each unit of five (starters, first bench unit, second
 * bench unit) gets one player per position, with positions shuffled within the unit so a team's
 * star can play anywhere. Each unit is then put in PG–C order for the engine's lineup slots.
 */
function leagueRosterSpots(rng: Rng, abilities: readonly number[]): RosterSpot[] {
  const spots: RosterSpot[] = []
  for (let start = 0; start < abilities.length; start += UNIT) {
    const unit = abilities.slice(start, start + UNIT)
    const positions = shuffledPositions(rng)
    const unitSpots = unit.map((targetCa, k) => ({ position: positions[k] as Position, targetCa }))
    unitSpots.sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position))
    spots.push(...unitSpots)
  }
  return spots
}

/** Roster spots for a uniform average team: starters near `averageCa`, bench a little lower. */
function averageRosterSpots(rng: Rng, averageCa: number, rosterSize: number): RosterSpot[] {
  return Array.from({ length: rosterSize }, (_, i) => {
    const level = i < UNIT ? averageCa : averageCa - AVERAGE_BENCH_CA_DROP
    const targetCa = Math.round(clamp(randomNormal(rng, level, AVERAGE_TEAM_CA_SD), 1, 100))
    return { position: POSITIONS[i % UNIT] as Position, targetCa }
  })
}

/** Builds a team from its roster spots. */
function buildTeam(rng: Rng, id: string, name: string, spots: readonly RosterSpot[]): MatchTeam {
  const roster = spots.map((spot, index) =>
    generatePlayer(rng, { id: `${id}-p${index + 1}`, ...spot }),
  )
  return { id, name, roster }
}

/** Best-first CA lists for `count` league teams (a full reference league is dealt, then cut). */
function leagueRosters(rng: Rng, count: number, rosterSize: number): number[][] {
  const poolTeams = Math.max(count, REFERENCE_TEAMS)
  const abilities = drawLeagueAbilities(rng, poolTeams, rosterSize)
  return dealRosters(rng, abilities, poolTeams).slice(0, count)
}

/**
 * Generates one team. By default it is a realistic league team (a random team from a freshly
 * drawn league); with `averageCa` it is a uniform average team.
 */
export function generateTeam(rng: Rng, options: TeamGenerationOptions): MatchTeam {
  const rosterSize = (options.rules ?? PRO_RULES).rosterSize
  const spots =
    options.averageCa === undefined
      ? leagueRosterSpots(rng, leagueRosters(rng, 1, rosterSize)[0] as number[])
      : averageRosterSpots(rng, options.averageCa, rosterSize)
  return buildTeam(rng, options.id, options.name ?? rng.pick(TEAM_NAMES), spots)
}

/** Picks `count` different team names from the built-in pool (a partial Fisher–Yates shuffle). */
export function pickTeamNames(rng: Rng, count: number): string[] {
  if (count > TEAM_NAMES.length) throw new RangeError(`Only ${TEAM_NAMES.length} team names`)
  const pool = [...TEAM_NAMES]
  // Swap a random remaining name into each position, so no name can be drawn twice.
  for (let i = 0; i < count; i++) {
    const j = rng.nextInt(i, pool.length - 1)
    ;[pool[i], pool[j]] = [pool[j] as string, pool[i] as string]
  }
  return pool.slice(0, count)
}

/**
 * Distinct names for a league's teams: random names from the built-in pool, then numbered
 * placeholders ("Team 31", ...) once the pool runs out, so any league size can be generated.
 */
export function leagueTeamNames(rng: Rng, count: number): string[] {
  const named = pickTeamNames(rng, Math.min(count, TEAM_NAMES.length))
  const numbered = Array.from({ length: count - named.length }, (_, i) => {
    return `Team ${named.length + i + 1}`
  })
  return [...named, ...numbered]
}

/**
 * Generates the teams of one league with distinct names (ids "T1", "T2", ...). They share one
 * talent pool, so a 30-team league has the doc's tier distribution (e.g. at most 2 GOATs).
 */
export function generateLeague(
  rng: Rng,
  count: number,
  rules: LeagueRules = PRO_RULES,
): MatchTeam[] {
  const names = leagueTeamNames(rng, count)
  const rosters = leagueRosters(rng, count, rules.rosterSize)
  return names.map((name, i) =>
    buildTeam(rng, `T${i + 1}`, name, leagueRosterSpots(rng, rosters[i] as number[])),
  )
}
