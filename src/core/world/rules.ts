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

/**
 * Who starts each period after the opening tip (no held balls are modelled during play):
 * - `quarterRotation`: the opening-tip loser starts Q2 and Q3, the winner Q4; every overtime
 *   starts with a new jump ball (North American pro).
 * - `alternatingArrow`: the alternating-possession arrow. The team that lost the opening tip
 *   starts Q2, then it alternates every period, overtimes included (FIBA).
 */
export type PeriodStartRule = 'quarterRotation' | 'alternatingArrow'

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
  /**
   * Final-period/overtime window (seconds) in which a foul away from the play gives the opponent
   * one free throw (any shooter) plus possession (NBA, last 2:00). Null = no such rule.
   */
  awayFromPlayFoulWindowSeconds: number | null
  /** Fouls allowed inside the late window before the bonus applies. */
  lateFoulsBeforePenalty: number
  /** Free throws awarded for a penalized non-shooting foul. */
  penaltyFreeThrows: number
  /** Technical fouls that eject a player. */
  technicalFoulsToEject: number
  /** True if a technical foul also counts toward the personal-foul limit (FIBA). */
  technicalsCountTowardFoulLimit: boolean
  /**
   * True if offensive fouls also count as team fouls toward the bonus (FIBA). Either way they are
   * personal fouls.
   */
  offensiveFoulsCountAsTeamFouls: boolean
  /**
   * What happens when a player who FOULED OUT has nobody to replace him. A player ejected on
   * technicals always leaves the floor, whatever this says.
   */
  noBenchDisqualification: NoBenchDisqualificationRule
  /** Who starts each period with the ball after the opening tip. */
  periodStartRule: PeriodStartRule
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
  // NBA away-from-the-play rule: in the last 2:00 of Q4/OT an off-ball foul shoots 1 + the ball.
  awayFromPlayFoulWindowSeconds: 120,
  lateFoulsBeforePenalty: 1,
  penaltyFreeThrows: 2,
  technicalFoulsToEject: 2,
  technicalsCountTowardFoulLimit: false,
  // Our reading of the NBA rulebook (Rule 12B): offensive fouls (charges included) are personal
  // fouls but are not counted toward the team-foul penalty. Check against the rulebook before
  // relying on it for a licensed league.
  offensiveFoulsCountAsTeamFouls: false,
  noBenchDisqualification: 'staysOn',
  periodStartRule: 'quarterRotation',
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
  // FIBA has no free-throw-plus-possession window like the NBA's. Its own late-game variant
  // (defensive contact during a last-2:00 throw-in is an unsportsmanlike foul) isn't modelled.
  awayFromPlayFoulWindowSeconds: null,
  lateFoulsBeforePenalty: 0,
  penaltyFreeThrows: 2,
  technicalFoulsToEject: 2,
  technicalsCountTowardFoulLimit: true,
  // Our reading of the FIBA rules (Art. 41): every player foul, offensive ones included, is a
  // team foul. Check against the current rulebook.
  offensiveFoulsCountAsTeamFouls: true,
  noBenchDisqualification: 'playShorthanded',
  // FIBA Art. 12.5: every period after the first, overtimes included, starts with an
  // alternating-possession throw-in; the arrow first points to the team that lost the opening tip.
  periodStartRule: 'alternatingArrow',
}
