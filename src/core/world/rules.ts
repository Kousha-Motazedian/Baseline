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

/**
 * Timeout allowances (docs/design/timeouts.md, section 1). Data, so each league sets its own.
 *
 * Regulation timeouts come in pools: `scope: 'game'` is one pool for the whole game (pro, 7);
 * `scope: 'half'` gives each half its own pool and leftovers from the first half are lost
 * (FIBA, 2 + 3). Late limits cap how many may be used in the final period or in its last
 * seconds, whatever the pool still holds.
 */
export interface TimeoutRules {
  scope: 'game' | 'half'
  /** Pool sizes: one entry for `game` scope, [first half, second half] for `half` scope. */
  allowances: number[]
  /** Most timeouts a team may use in the final regulation period. Null = no such limit. */
  finalPeriodMax: number | null
  /** The last `lateWindowSeconds` of the final period allow at most `lateMax` (null = no limit). */
  lateWindowSeconds: number
  lateMax: number | null
  /** Timeouts each team gets in every overtime period. */
  overtimeAllowance: number
  /** True if unused regulation timeouts carry into overtime (pro: yes; FIBA: no). */
  overtimeCarryOver: boolean
  /**
   * Window (seconds left) in the final period and overtime in which a timeout lets the offense
   * inbound the ball in the frontcourt. Null = never.
   */
  advanceBallWindowSeconds: number | null
}

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
  /** Timeout allowances and the late-game limits on them. */
  timeouts: TimeoutRules
  /** Players on each team's roster (the generator builds rosters of this size). */
  rosterSize: number
  /**
   * The range of per-team coaching salary caps per season, in the league's currency units
   * (separate from any player salary cap; see docs/design/coaches.md, section 6). A team's own
   * cap sits inside this range according to its financial power (see `teamCoachCap`).
   */
  coachCapRange: { min: number; max: number }
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
  // Pro: 7 a game, at most 4 in the 4th and at most 2 in its last 3:00; 2 per overtime, and
  // unused regulation timeouts carry into overtime (they are not lost).
  timeouts: {
    scope: 'game',
    allowances: [7],
    finalPeriodMax: 4,
    lateWindowSeconds: 180,
    lateMax: 2,
    overtimeAllowance: 2,
    overtimeCarryOver: true,
    advanceBallWindowSeconds: 120,
  },
  // 15 standard contracts per team: 30 teams give the design docs' ~450-player league.
  rosterSize: 15,
  // In US dollars (no player salary data exists yet to scale against). Real NBA head coaches earn
  // roughly $2M to $15M+ a season; a $15M cap lets the league's most famous coach just fit and
  // leaves room for assistants' salaries to join this budget in 2.0. The poorest team gets 6M, a
  // 2.5x spread, so small markets can't afford the famous coaches (an average team gets 10.5M).
  coachCapRange: { min: 6_000_000, max: 15_000_000 },
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
  // FIBA: 2 in the first half, 3 in the second (first-half leftovers are lost), at most 2 in the
  // last 2:00 of the 4th; 1 per overtime, and regulation leftovers don't carry over.
  timeouts: {
    scope: 'half',
    allowances: [2, 3],
    finalPeriodMax: null,
    lateWindowSeconds: 120,
    lateMax: 2,
    overtimeAllowance: 1,
    overtimeCarryOver: false,
    advanceBallWindowSeconds: 120,
  },
  // FIBA game rosters list 12 players.
  rosterSize: 12,
  // In euros. Top European club head coaches earn on the order of EUR 1–2M a season and most far
  // less, so the range is about a tenth of the pro league's (same 2.5x spread).
  coachCapRange: { min: 600_000, max: 1_500_000 },
}
