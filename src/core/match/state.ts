import type { Player } from '../players/types.ts'
import { fullName } from '../players/types.ts'
import type { Rng } from '../shared/rng.ts'
import type { LeagueRules } from '../world/rules.ts'
import { FORM_EDGE_MAX } from './tuning.ts'
import type { MatchTeam, PlayByPlayEntry, PlayerLine, PlayType, ShotTally } from './types.ts'
import { PLAY_TYPES } from './types.ts'

/**
 * Mutable state for one game in progress.
 * The engine mutates this while simulating (it's local to a single simulateGame call),
 * which keeps each step simple; the finished result handed back to callers is plain data.
 */

/** One team's live state during a game. */
export interface TeamState {
  team: MatchTeam
  isHome: boolean
  /** The five players on the floor. Index = lineup slot; slot i guards the opponent's slot i. */
  onCourt: Player[]
  lines: Map<string, PlayerLine>
  /** Game-day form per player, as a log-odds edge (from the hidden Consistency attribute). */
  form: Map<string, number>
  points: number
  periodPoints: number[]
  possessions: number
  shotsByPlayType: Record<PlayType, ShotTally>
}

/** The whole game's live state. */
export interface GameState {
  rng: Rng
  rules: LeagueRules
  home: TeamState
  away: TeamState
  period: number
  /** Seconds left in the current period. */
  clock: number
  playByPlay: PlayByPlayEntry[]
}

/** Creates an empty box score line for a player. */
export function createPlayerLine(player: Player): PlayerLine {
  return {
    playerId: player.id,
    name: fullName(player),
    secondsPlayed: 0,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threesMade: 0,
    threesAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    personalFouls: 0,
  }
}

/** Creates an all-zero field goal tally for every play type. */
export function createShotTallies(): Record<PlayType, ShotTally> {
  return Object.fromEntries(PLAY_TYPES.map((t) => [t, { attempted: 0, made: 0 }])) as Record<
    PlayType,
    ShotTally
  >
}

/** Rolls a player's form for today's game: inconsistent players swing further either way. */
export function rollForm(rng: Rng, player: Player): number {
  // Consistency 20 → almost no swing; Consistency 1 → up to ±FORM_EDGE_MAX.
  const swing = FORM_EDGE_MAX * ((21 - player.hidden.consistency) / 20)
  return (rng.next() * 2 - 1) * swing
}

/** Sets up a team's state at tip-off: starters on the floor, empty box score, form rolled. */
export function createTeamState(rng: Rng, team: MatchTeam, isHome: boolean): TeamState {
  if (team.roster.length < 5) throw new RangeError(`${team.name} needs at least 5 players`)
  return {
    team,
    isHome,
    onCourt: team.roster.slice(0, 5),
    lines: new Map(team.roster.map((p) => [p.id, createPlayerLine(p)])),
    form: new Map(team.roster.map((p) => [p.id, rollForm(rng, p)])),
    points: 0,
    periodPoints: [],
    possessions: 0,
    shotsByPlayType: createShotTallies(),
  }
}

/** Returns a player's box score line (every roster player has one from tip-off). */
export function lineOf(team: TeamState, player: Player): PlayerLine {
  const line = team.lines.get(player.id)
  if (!line) throw new Error(`No box score line for player ${player.id}`)
  return line
}

/** Adds points to a player and their team, including the current period's total. */
export function addPoints(game: GameState, team: TeamState, player: Player, points: number): void {
  lineOf(team, player).points += points
  team.points += points
  const periodIndex = game.period - 1
  team.periodPoints[periodIndex] = (team.periodPoints[periodIndex] ?? 0) + points
}

/** Appends a play-by-play line at the current game clock. */
export function log(game: GameState, team: TeamState, text: string): void {
  game.playByPlay.push({
    period: game.period,
    clockSeconds: game.clock,
    teamId: team.team.id,
    text,
    homeScore: game.home.points,
    awayScore: game.away.points,
  })
}

/** Runs time off the clock and credits it to everyone on the floor. Returns the seconds actually used. */
export function runClock(game: GameState, seconds: number): number {
  const used = Math.min(seconds, game.clock)
  game.clock -= used
  for (const team of [game.home, game.away]) {
    for (const player of team.onCourt) lineOf(team, player).secondsPlayed += used
  }
  return used
}

/** The defender assigned to an offensive player: whoever is in the same lineup slot. */
export function matchupDefender(offense: TeamState, defense: TeamState, player: Player): Player {
  // Simple slot-for-slot matchups for now; tactics will later allow custom assignments.
  const slot = offense.onCourt.indexOf(player)
  return defense.onCourt[slot] ?? (defense.onCourt[0] as Player)
}

/** True during clutch time: late in the last regulation period or overtime, in a close game. */
export function isClutch(game: GameState, clutchSeconds: number, margin: number): boolean {
  const lateEnough = game.period >= game.rules.periods && game.clock <= clutchSeconds
  return lateEnough && Math.abs(game.home.points - game.away.points) <= margin
}

/** Short name used in play-by-play, e.g. "Hale". */
export function shortName(player: Player): string {
  return player.lastName
}
