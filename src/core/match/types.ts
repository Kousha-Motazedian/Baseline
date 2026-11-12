import type { Player } from '../players/types.ts'

/** The five kinds of offensive play the engine can run. */
export type PlayType = 'drive' | 'cut' | 'postUp' | 'midRange' | 'three'

export const PLAY_TYPES: readonly PlayType[] = ['drive', 'cut', 'postUp', 'midRange', 'three']

/** A team as the match engine sees it. The first five roster players start. */
export interface MatchTeam {
  id: string
  name: string
  roster: Player[]
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
  personalFouls: number
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
  players: PlayerLine[]
}

/** One line of play-by-play commentary. */
export interface PlayByPlayEntry {
  period: number
  /** Seconds left on the game clock in the period. */
  clockSeconds: number
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
