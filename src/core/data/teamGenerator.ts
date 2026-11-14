import type { MatchTeam } from '../match/types.ts'
import { AVERAGE_RATING } from '../shared/probability.ts'
import type { Rng } from '../shared/rng.ts'
import { TEAM_NAMES } from './names.ts'
import type { Archetype } from './playerGenerator.ts'
import { generatePlayer } from './playerGenerator.ts'

/** What the caller controls when generating a team. */
export interface TeamGenerationOptions {
  id: string
  /** Team name; a random fictional one is picked if omitted. */
  name?: string
  /** Mean visible rating of the starters (10.5 = league average). */
  quality?: number
}

/**
 * Roster archetypes in order. The first five are the starters in lineup-slot order
 * G, G, W, W, B, so that the match engine's slot-for-slot matchups pit guards against guards,
 * wings against wings and bigs against bigs. The bench mirrors that shape with an extra big.
 */
export const ROSTER_ARCHETYPES: readonly Archetype[] = [
  'guard',
  'guard',
  'wing',
  'wing',
  'big',
  'guard',
  'guard',
  'wing',
  'big',
  'big',
]

/** How much weaker bench players are than starters, in mean rating points. */
const BENCH_QUALITY_DROP = 1.5

/** Number of starters at the front of the roster. */
const STARTERS = 5

/** Generates a 10-player team: five starters (G, G, W, W, B) and a slightly weaker bench. */
export function generateTeam(rng: Rng, options: TeamGenerationOptions): MatchTeam {
  const quality = options.quality ?? AVERAGE_RATING
  const roster = ROSTER_ARCHETYPES.map((archetype, index) =>
    generatePlayer(rng, {
      id: `${options.id}-p${index + 1}`,
      archetype,
      quality: index < STARTERS ? quality : quality - BENCH_QUALITY_DROP,
    }),
  )
  return { id: options.id, name: options.name ?? rng.pick(TEAM_NAMES), roster }
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

/** Generates several teams of the same quality with distinct names (ids "T1", "T2", ...). */
export function generateTeams(rng: Rng, count: number, quality?: number): MatchTeam[] {
  return pickTeamNames(rng, count).map((name, i) =>
    generateTeam(rng, { id: `T${i + 1}`, name, quality }),
  )
}
