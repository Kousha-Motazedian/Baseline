/**
 * League rule sets. Rules are data, never hard-coded in the engine, so different leagues
 * (North American pro, FIBA/international, college) can each use their own.
 */

/** The game rules a league plays under. */
export interface LeagueRules {
  name: string
  /** Number of regulation periods (quarters). */
  periods: number
  /** Length of one regulation period, in seconds. */
  periodSeconds: number
  /** Length of one overtime period, in seconds. */
  overtimeSeconds: number
  /** Full shot clock, in seconds. */
  shotClockSeconds: number
  /** Shot clock after an offensive rebound, in seconds. */
  offensiveReboundShotClockSeconds: number
  /** Personal fouls that disqualify a player. */
  personalFoulLimit: number
}

/** North American pro rules: 4 x 12-minute quarters, foul out on 6. */
export const PRO_RULES: LeagueRules = {
  name: 'Pro',
  periods: 4,
  periodSeconds: 12 * 60,
  overtimeSeconds: 5 * 60,
  shotClockSeconds: 24,
  offensiveReboundShotClockSeconds: 14,
  personalFoulLimit: 6,
}

/** FIBA/international rules: 4 x 10-minute quarters, foul out on 5. */
export const FIBA_RULES: LeagueRules = {
  name: 'FIBA',
  periods: 4,
  periodSeconds: 10 * 60,
  overtimeSeconds: 5 * 60,
  shotClockSeconds: 24,
  offensiveReboundShotClockSeconds: 14,
  personalFoulLimit: 5,
}
