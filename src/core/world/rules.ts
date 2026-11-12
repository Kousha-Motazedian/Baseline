/**
 * League rule sets. Rules are data, never hard-coded in the engine, so different leagues
 * (North American pro, FIBA/international, college) can each use their own.
 */

/**
 * What happens when a player is disqualified (6th/5th foul, or ejected) and no eligible
 * substitute is left:
 * - `staysOn`: the player stays on the floor; every further personal foul he commits is charged
 *   as a technical (one free throw for the opponent) instead of another personal foul (pro).
 * - `playShorthanded`: the team plays on with fewer players (FIBA), never fewer than one.
 */
export type NoBenchDisqualificationRule = 'staysOn' | 'playShorthanded'

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
  /** The shot clock is reset to at least this after a defensive foul without free throws. */
  foulResetShotClockSeconds: number
  /** Personal fouls that disqualify a player. */
  personalFoulLimit: number
  /**
   * Team fouls a team may commit in a regulation period before every further defensive foul is
   * penalized with free throws (the "bonus"). 4 in both leagues: the 5th foul shoots.
   */
  teamFoulsBeforePenalty: number
  /** Same allowance for each overtime period (ignored when overtime fouls carry over). */
  overtimeTeamFoulsBeforePenalty: number
  /** True if overtime periods continue the last regulation period's team-foul count (FIBA). */
  overtimeTeamFoulsCarryOver: boolean
  /**
   * Length of the late-period window in which a team may commit only `lateFoulsBeforePenalty`
   * fouls before the bonus, whatever its period total (pro: last 2:00). Null = no such rule.
   */
  lateFoulWindowSeconds: number | null
  /** Fouls allowed inside the late window before the bonus applies. */
  lateFoulsBeforePenalty: number
  /** Free throws awarded for a penalized non-shooting foul. */
  penaltyFreeThrows: number
  /** Technical fouls that eject a player. */
  technicalFoulsToEject: number
  /** True if a technical foul also counts toward the personal-foul limit (FIBA). */
  technicalsCountTowardFoulLimit: boolean
  /** What happens when a disqualified player has nobody to replace him. */
  noBenchDisqualification: NoBenchDisqualificationRule
}

/** North American pro rules: 4 x 12-minute quarters, foul out on 6. */
export const PRO_RULES: LeagueRules = {
  name: 'Pro',
  periods: 4,
  periodSeconds: 12 * 60,
  overtimeSeconds: 5 * 60,
  shotClockSeconds: 24,
  offensiveReboundShotClockSeconds: 14,
  foulResetShotClockSeconds: 14,
  personalFoulLimit: 6,
  // 5th foul of a quarter shoots; in each 5-minute overtime the 4th does.
  teamFoulsBeforePenalty: 4,
  overtimeTeamFoulsBeforePenalty: 3,
  overtimeTeamFoulsCarryOver: false,
  // A team's 2nd foul in the last 2:00 of any period shoots, even if it's under the period limit.
  lateFoulWindowSeconds: 120,
  lateFoulsBeforePenalty: 1,
  penaltyFreeThrows: 2,
  technicalFoulsToEject: 2,
  technicalsCountTowardFoulLimit: false,
  noBenchDisqualification: 'staysOn',
}

/** FIBA/international rules: 4 x 10-minute quarters, foul out on 5. */
export const FIBA_RULES: LeagueRules = {
  name: 'FIBA',
  periods: 4,
  periodSeconds: 10 * 60,
  overtimeSeconds: 5 * 60,
  shotClockSeconds: 24,
  offensiveReboundShotClockSeconds: 14,
  foulResetShotClockSeconds: 14,
  personalFoulLimit: 5,
  // After 4 team fouls in a quarter every defensive foul shoots; overtime continues Q4's count.
  teamFoulsBeforePenalty: 4,
  overtimeTeamFoulsBeforePenalty: 4,
  overtimeTeamFoulsCarryOver: true,
  lateFoulWindowSeconds: null,
  lateFoulsBeforePenalty: 0,
  penaltyFreeThrows: 2,
  technicalFoulsToEject: 2,
  technicalsCountTowardFoulLimit: true,
  noBenchDisqualification: 'playShorthanded',
}
