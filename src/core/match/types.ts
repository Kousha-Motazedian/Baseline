import type { Player } from '../players/types.ts'
import type { TeamSystem } from '../tactics/system.ts'

/**
 * The kinds of shot the engine can produce. The first five are the half-court plays a team
 * chooses between; a putback only happens right after an offensive rebound.
 */
export type PlayType = 'drive' | 'cut' | 'postUp' | 'midRange' | 'three' | 'putback'

/** Every play type, for box score tallies. */
export const PLAY_TYPES: readonly PlayType[] = [
  'drive',
  'cut',
  'postUp',
  'midRange',
  'three',
  'putback',
]

/** The play types an offense chooses between when it runs a set (everything but putbacks). */
export const HALF_COURT_PLAY_TYPES: readonly PlayType[] = [
  'drive',
  'cut',
  'postUp',
  'midRange',
  'three',
]

/**
 * Coaching inputs for one game (see src/core/tactics/coaching.ts, which builds them from the head
 * coach). Both execution edges are small log-odds edges; 0 is an average coach on his own system.
 */
export interface TeamCoaching {
  /** The system actually run (the coach's preferred one, or the GM's override). */
  system: TeamSystem
  /** Log-odds edge on the team's offensive outcomes. */
  offensiveExecution: number
  /** Log-odds edge on the team's defensive outcomes. */
  defensiveExecution: number
}

/** A team as the match engine sees it. The first five roster players start. */
export interface MatchTeam {
  id: string
  name: string
  roster: Player[]
  /**
   * Coaching inputs for one game. Optional: absent = BALANCED_SYSTEM with zero execution edges
   * (today's behaviour, byte-identical).
   */
  coaching?: TeamCoaching
}

/** One player's box score line. */
export interface PlayerLine {
  playerId: string
  name: string
  secondsPlayed: number
  points: number
  fieldGoalsMade: number
  fieldGoalsAttempted: number
  threesMade: number
  threesAttempted: number
  freeThrowsMade: number
  freeThrowsAttempted: number
  offensiveRebounds: number
  defensiveRebounds: number
  assists: number
  steals: number
  blocks: number
  turnovers: number
  /** Personal fouls (shooting, non-shooting and offensive; technicals too where they count). */
  personalFouls: number
  technicalFouls: number
}

/** Field goal attempts and makes for one play type. */
export interface ShotTally {
  attempted: number
  made: number
}

/** One team's result: score, scoring by period, and player box score lines. */
export interface TeamResult {
  teamId: string
  name: string
  points: number
  periodPoints: number[]
  possessions: number
  /** Field goals by play type (excludes fouled misses, which don't count as attempts). */
  shotsByPlayType: Record<PlayType, ShotTally>
  /** Points scored on the transition action of a fast break (including its free throws). */
  fastBreakPoints: number
  /** Points scored on possessions that started with an opponent turnover. */
  pointsOffTurnovers: number
  /**
   * Offensive team rebounds: blocked shots that went out of bounds off the defense, so the
   * offense kept the ball without any player grabbing a rebound.
   */
  teamRebounds: number
  players: PlayerLine[]
}

/**
 * One line of play-by-play commentary.
 *
 * Convention: entries are in chronological order (a fouled make is logged as the shot, then the
 * foul, then the free throws), and `teamId` is the team that PERFORMED the action: blocks,
 * steals and defensive fouls belong to the defense; shots, turnovers and free throws to the
 * shooting/offensive team; rebounds to the rebounding team.
 */
export interface PlayByPlayEntry {
  period: number
  /** Seconds left on the game clock in the period. */
  clockSeconds: number
  /** The team that performed the action (see the convention above). */
  teamId: string
  text: string
  homeScore: number
  awayScore: number
}

/** The complete result of a simulated game. */
export interface MatchResult {
  home: TeamResult
  away: TeamResult
  periodsPlayed: number
  playByPlay: PlayByPlayEntry[]
}
