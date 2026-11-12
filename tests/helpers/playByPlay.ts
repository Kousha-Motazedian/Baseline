/**
 * Play-by-play parsing for tests. The engine logs last names only, so these helpers map a line
 * back to the player (and team) it is about, which lets tests check the "teamId = the team that
 * performed the action" convention and replay foul counts from the log.
 */
import type { MatchResult, MatchTeam, PlayByPlayEntry } from '../../src/core/match/types.ts'

/** Personal-foul lines ("<kind> on <name>"), including offensive and intentional fouls. */
export const PERSONAL_FOUL_LINE =
  /^(Shooting foul|Reach-in foul|Blocking foul|Holding foul|Loose-ball foul|Offensive foul \(charge\)|Offensive foul|Intentional foul) on (\S+)/

/** Defensive non-shooting fouls: these shoot free throws only when the fouling team is in the bonus. */
export const BONUS_FOUL_KINDS: ReadonlySet<string> = new Set([
  'Reach-in foul',
  'Blocking foul',
  'Holding foul',
  'Loose-ball foul',
  'Intentional foul',
])

/** Lines that start with the name of the player who performed the action. */
const ACTOR_FIRST_LINE =
  /^(\S+) (makes|misses|turnover|steal$|offensive rebound$|defensive rebound$|recovers the block$|blocks )/

/** Lines naming the player who committed a foul or technical ("... on <name>"). */
const FOULER_LINE = /^(?:.*foul(?: \(charge\))?) on (\S+)/

/** Lines that can sit between a foul and its free throws without changing what the foul awarded. */
const FOUL_AFTERMATH_LINE =
  /^Technical foul on |technical free throw|fouls out|is ejected|checks in|stays in|play with \d/

/**
 * Maps each last name to its team id. A last name used on both teams maps to undefined, so
 * callers skip lines they can't attribute instead of guessing.
 */
export function lastNameOwners(result: MatchResult): Map<string, string | undefined> {
  const owners = new Map<string, string | undefined>()
  for (const team of [result.home, result.away]) {
    for (const line of team.players) {
      const lastName = line.name.split(' ').at(-1) ?? line.name
      const known = owners.get(lastName)
      owners.set(lastName, owners.has(lastName) && known !== team.teamId ? undefined : team.teamId)
    }
  }
  return owners
}

/** The player a line is "about" for team attribution: the actor, or the player called for a foul. */
export function attributedName(text: string): string | undefined {
  return ACTOR_FIRST_LINE.exec(text)?.[1] ?? FOULER_LINE.exec(text)?.[1]
}

/** The first line after `index` that isn't the aftermath of a foul (technicals, foul-outs, subs). */
export function nextPlayLine(
  log: readonly PlayByPlayEntry[],
  index: number,
): PlayByPlayEntry | undefined {
  return log.slice(index + 1).find((entry) => !FOUL_AFTERMATH_LINE.test(entry.text))
}

/** A copy of a team whose players all have distinct last names (prefixed with the team id). */
export function withUniqueNames(team: MatchTeam): MatchTeam {
  // Generated rosters can repeat a last name, which would make play-by-play lines ambiguous.
  const roster = team.roster.map((p, i) => ({ ...p, lastName: `${team.id}${i}${p.lastName}` }))
  return { ...team, roster }
}
