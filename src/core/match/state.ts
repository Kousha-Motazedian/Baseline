import type { Player } from '../players/types.ts'
import { fullName } from '../players/types.ts'
import { randomNormal } from '../shared/normal.ts'
import { clamp } from '../shared/probability.ts'
import type { Rng } from '../shared/rng.ts'
import type { LeagueRules } from '../world/rules.ts'
import { PRO_RULES } from '../world/rules.ts'
import { BALANCED_SYSTEM } from '../tactics/system.ts'
import type { RotationCoach, RotationPlan } from '../tactics/rotation.ts'
import { buildRotationPlan, NEUTRAL_ROTATION_COACH } from '../tactics/rotation.ts'
import type { TeamTactics } from './coaching.ts'
import { teamTactics } from './coaching.ts'
import type { EndGameLapses } from './endGame.ts'
import { rollEndGameLapses } from './endGame.ts'
import type { AfterTimeout, TimeoutUse } from './timeouts.ts'
import { energyOf, FULL_ENERGY, systemDrainFactor, tickEnergy } from './fatigue.ts'
import {
  EXHAUSTED_ENERGY,
  FORM_CLAMP_SDS,
  FORM_CURVE_EXPONENT,
  FORM_SD_AT_MAX_CONSISTENCY,
  FORM_SD_AT_MIN_CONSISTENCY,
} from './tuning.ts'
import type { MatchTeam, PlayByPlayEntry, PlayerLine, PlayType, ShotTally } from './types.ts'
import { PLAY_TYPES } from './types.ts'

/**
 * Mutable state for one game in progress.
 * The engine mutates this while simulating (it's local to a single simulateGame call),
 * which keeps each step simple; the finished result handed back to callers is plain data.
 */

/**
 * A player's game-day form as log-odds edges, rolled independently for each end of the floor:
 * a hot shooting night says nothing about how well he defends.
 */
export interface PlayerForm {
  offense: number
  defense: number
}

/** Which end of the floor a player is acting at (picks which form roll applies). */
export type CourtEnd = 'offense' | 'defense'

/** One team's live state during a game. */
export interface TeamState {
  team: MatchTeam
  isHome: boolean
  /** The team's system, coach execution and player fit for this game (neutral without coaching). */
  tactics: TeamTactics
  /**
   * The players on the floor (normally five; fewer only when a FIBA team runs out of eligible
   * players). Index = lineup slot; slot i guards the opponent's slot i.
   */
  onCourt: Player[]
  /** The coach's plan for this game (starters, bench order, target minutes, closers). */
  plan: RotationPlan
  /** The coach attributes that drive his in-game substitution decisions. */
  coach: RotationCoach
  /** Energy (0-100) per roster player; see fatigue.ts. */
  energy: Map<string, number>
  /** Multiplier on this team's energy drain from its system (pace, pushing, pressure). */
  drainFactor: number
  lines: Map<string, PlayerLine>
  /** Game-day form per player, offense and defense (from the hidden Consistency attribute). */
  form: Map<string, PlayerForm>
  /** Ids of players who fouled out or were ejected; they can never check back in. */
  disqualified: Set<string>
  /** Team fouls in the current foul period (a quarter, or an overtime unless they carry over). */
  teamFouls: number
  /** Team fouls committed inside the current period's late-foul window (pro: last 2:00). */
  lateTeamFouls: number
  points: number
  periodPoints: number[]
  possessions: number
  shotsByPlayType: Record<PlayType, ShotTally>
  fastBreakPoints: number
  pointsOffTurnovers: number
  teamRebounds: number
  /** Player-seconds on the floor below EXHAUSTED_ENERGY (diagnostic). */
  exhaustedSeconds: number
  /** Timeouts taken so far (when each was called); the rules decide how many are left. */
  timeoutLog: TimeoutUse[]
  /** What the last timeout leaves for the next possession (cleared after it). */
  afterTimeout: AfterTimeout | undefined
  /** 2-for-1 shots the team went for (diagnostic, shown in the batch report). */
  twoForOnes: number
  /** The coach's end-game calls for this game (fouling up 3, forgetting the chase foul). */
  lapses: EndGameLapses
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
  /** The current unanswered scoring run (feeds the coach's timeout decision). */
  run: { team: TeamState | undefined; points: number }
}

/** Creates an empty box score line for a player. */
export function createPlayerLine(player: Player): PlayerLine {
  return {
    playerId: player.id,
    name: fullName(player),
    started: false,
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
    technicalFouls: 0,
  }
}

/** Creates an all-zero field goal tally for every play type. */
export function createShotTallies(): Record<PlayType, ShotTally> {
  return Object.fromEntries(PLAY_TYPES.map((t) => [t, { attempted: 0, made: 0 }])) as Record<
    PlayType,
    ShotTally
  >
}

/** Standard deviation of a player's game-day form (log-odds), from the hidden Consistency. */
export function formSpread(consistency: number): number {
  // Convex curve from SD_AT_MIN (Consistency 1) down to SD_AT_MAX (Consistency 20): the low end
  // is wild (Consistency 1 swings ~10x more than 20), while the many players near average stay
  // close to the old, narrow spread. Form is independent per player, so a wide spread for the
  // AVERAGE player would add a lot of team-level noise and inflate final-margin spread.
  const wildness = ((20 - clamp(consistency, 1, 20)) / 19) ** FORM_CURVE_EXPONENT
  return (
    FORM_SD_AT_MAX_CONSISTENCY +
    wildness * (FORM_SD_AT_MIN_CONSISTENCY - FORM_SD_AT_MAX_CONSISTENCY)
  )
}

/** Rolls a player's form for today's game: inconsistent players swing further either way. */
export function rollForm(rng: Rng, player: Player): number {
  // Normal-shaped (most days near normal, occasional great or awful games) rather than uniform.
  // The symmetric clamp trims freak tails without moving the mean off zero.
  const sd = formSpread(player.hidden.consistency)
  return clamp(randomNormal(rng, 0, sd), -FORM_CLAMP_SDS * sd, FORM_CLAMP_SDS * sd)
}

/**
 * Rolls a player's offensive and defensive form for today's game. They're independent: one roll
 * moving both ends together made each player's net impact swing twice as far, which inflated the
 * final-margin spread (~1.3 points of SD) without making any single game more realistic.
 */
export function rollPlayerForm(rng: Rng, player: Player): PlayerForm {
  return { offense: rollForm(rng, player), defense: rollForm(rng, player) }
}

/** A fresh box score line, marked as a starter if the plan opens with him. */
function startedLine(player: Player, plan: RotationPlan): PlayerLine {
  return { ...createPlayerLine(player), started: plan.starters.includes(player.id) }
}

/** The opening five in slot order (slot i guards the opponent's slot i), straight from the plan. */
function startersOf(team: MatchTeam, plan: RotationPlan): Player[] {
  return plan.starters.map((id) => {
    const player = team.roster.find((p) => p.id === id)
    if (!player) throw new RangeError(`${team.name}: starter ${id} is not on the roster`)
    return player
  })
}

/** Sets up a team's state at tip-off: starters on the floor, empty box score, form rolled. */
export function createTeamState(
  rng: Rng,
  team: MatchTeam,
  isHome: boolean,
  rules: LeagueRules = PRO_RULES,
): TeamState {
  if (team.roster.length < 5) throw new RangeError(`${team.name} needs at least 5 players`)
  const system = team.coaching?.system ?? BALANCED_SYSTEM
  const coach = team.rotationCoach ?? NEUTRAL_ROTATION_COACH
  const plan = team.rotation ?? buildRotationPlan(team.roster, undefined, system, undefined, rules)
  return {
    team,
    isHome,
    tactics: teamTactics(team),
    onCourt: startersOf(team, plan),
    plan,
    coach,
    energy: new Map(team.roster.map((p) => [p.id, FULL_ENERGY])),
    drainFactor: systemDrainFactor(system),
    lines: new Map(team.roster.map((p) => [p.id, startedLine(p, plan)])),
    form: new Map(team.roster.map((p) => [p.id, rollPlayerForm(rng, p)])),
    disqualified: new Set(),
    teamFouls: 0,
    lateTeamFouls: 0,
    points: 0,
    periodPoints: [],
    possessions: 0,
    shotsByPlayType: createShotTallies(),
    fastBreakPoints: 0,
    pointsOffTurnovers: 0,
    teamRebounds: 0,
    exhaustedSeconds: 0,
    timeoutLog: [],
    afterTimeout: undefined,
    twoForOnes: 0,
    lapses: rollEndGameLapses(rng, coach),
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
  game.run = game.run.team === team ? { team, points: game.run.points + points } : { team, points }
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

/**
 * Runs time off the clock, credits it to everyone on the floor and tires them (the bench rests).
 * Returns the seconds actually used.
 */
export function runClock(game: GameState, seconds: number): number {
  const used = Math.min(seconds, game.clock)
  game.clock -= used
  for (const team of [game.home, game.away]) {
    for (const player of team.onCourt) {
      lineOf(team, player).secondsPlayed += used
      if (energyOf(team, player) < EXHAUSTED_ENERGY) team.exhaustedSeconds += used
    }
    tickEnergy(team, used)
  }
  return used
}

/** The defender assigned to an offensive player: whoever is in the same lineup slot. */
export function matchupDefender(offense: TeamState, defense: TeamState, player: Player): Player {
  // Simple slot-for-slot matchups for now; tactics will later allow custom assignments.
  // A short-handed defense (fewer than five) wraps around, so one defender covers two players.
  const slot = Math.max(0, offense.onCourt.indexOf(player))
  return defense.onCourt[slot % defense.onCourt.length] as Player
}

/** The other team in this game. */
export function opponentOf(game: GameState, team: TeamState): TeamState {
  return team === game.home ? game.away : game.home
}

/** True if this is the last regulation period or an overtime, with at most `seconds` left. */
export function isLateInGame(game: GameState, seconds: number): boolean {
  return game.period >= game.rules.periods && game.clock <= seconds
}

/** True during clutch time: late in the last regulation period or overtime, in a close game. */
export function isClutch(game: GameState, clutchSeconds: number, margin: number): boolean {
  return (
    isLateInGame(game, clutchSeconds) && Math.abs(game.home.points - game.away.points) <= margin
  )
}

/** A team's lead (negative when trailing). */
export function leadOf(game: GameState, team: TeamState): number {
  return team.points - opponentOf(game, team).points
}

/** True for an overtime period. */
export function isOvertime(game: GameState): boolean {
  return game.period > game.rules.periods
}

/** Short name used in play-by-play, e.g. "Hale". */
export function shortName(player: Player): string {
  return player.lastName
}
