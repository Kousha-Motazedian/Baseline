import type { ActionKind } from './outcome.ts'
import type { PlayType } from './types.ts'

/**
 * Calibration knobs for the match engine, all in one place.
 *
 * Base rates are what a league-average player (rating 10.5) produces against league-average
 * defense. Because players pick the plays they're good at, the *realized* league rates come out
 * a little higher than the base rates (e.g. drives finish ~62% vs. a 61% base), so the bases are
 * tuned with `npm run sim:batch` until the league averages match real modern pro-league numbers.
 * See docs/design/match-engine.md for the targets and the latest results.
 */

// ---------------------------------------------------------------------------------------------
// Play selection
// ---------------------------------------------------------------------------------------------

/**
 * Relative frequency of each half-court play type before player/defense fit is applied. Tuned
 * so the realized FGA mix (putbacks and fast breaks included) lands near a modern pro league:
 * ~40% threes, ~22% mid-range (incl. floaters and short jumpers), the rest at the rim or post.
 */
export const BASE_PLAY_SHARE: Partial<Record<PlayType, number>> = {
  drive: 0.275,
  cut: 0.105,
  postUp: 0.09,
  midRange: 0.193,
  three: 0.375,
}

/**
 * Play mix on a fast break: mostly a run to the rim, sometimes a trailing open three, rarely a
 * pull-up. No post-ups or set cuts in transition.
 */
export const TRANSITION_PLAY_SHARE: Partial<Record<PlayType, number>> = {
  drive: 0.7,
  midRange: 0.05,
  three: 0.25,
}

/**
 * How strongly players gravitate toward plays that suit their strengths (log-weight per
 * normalized rating). 0 = everyone runs everything equally; 2.5 means a player 4 points above
 * average at a play runs it ~3x as often, close to the old cubic rule near average ratings.
 */
export const PLAY_FIT_OFFENSE_WEIGHT = 2.5
/**
 * How strongly the offense avoids plays the defense is good at stopping (and attacks weak
 * defenders). Lower than the offense weight: tendencies come mostly from the player's own game,
 * the matchup only bends them.
 */
export const PLAY_FIT_DEFENSE_WEIGHT = 1.5

/**
 * How much shot volume concentrates on the lineup's most attractive player. 1 = proportional to
 * their total play weight; 0.6 keeps the top scorer near ~29% of team FGA (see choosePlay).
 */
export const USAGE_EXPONENT = 0.6

/**
 * How strongly the ball-handler pick favours good handlers (log-weight per normalized
 * handler skill). 3 makes a guard with handler skill 14 start ~9x as many actions as a big
 * with 7, so guards throw most passes, as in real offenses.
 */
export const HANDLER_PICK_WEIGHT = 3

// ---------------------------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------------------------

/**
 * Chance an average shot goes in, by play type (before the matchup edge). Putbacks are close
 * finishes but heavily contested (the defense is already at the rim).
 */
export const BASE_MAKE: Record<PlayType, number> = {
  drive: 0.595,
  cut: 0.665,
  postUp: 0.465,
  midRange: 0.39,
  three: 0.325,
  putback: 0.58,
}

/**
 * Chance a shot attempt draws a shooting foul, by play type. Lowered from the first prototype
 * (which had to carry every free-throw trip on shooting fouls) now that bonus fouls, technicals
 * and intentional fouls also send players to the line.
 */
export const BASE_SHOOTING_FOUL: Record<PlayType, number> = {
  drive: 0.185,
  cut: 0.12,
  postUp: 0.16,
  midRange: 0.042,
  three: 0.016,
  putback: 0.11,
}

/**
 * Chance a made shot off a pass counts as an assist, by play type. Cuts and spot-up threes off a
 * pass are almost always assisted; a post entry or a drive after a catch usually isn't (the
 * shooter still had to create). Shots without a pass (the handler kept it, putbacks) are never
 * assisted. Tuned to ~60% of FGM assisted.
 */
export const BASE_ASSIST: Record<PlayType, number> = {
  drive: 0.7,
  cut: 0.98,
  postUp: 0.62,
  midRange: 0.82,
  three: 0.95,
  putback: 0,
}

/**
 * Share of (unfouled) missed shots that were blocked, by play type. Shots near the rim get
 * blocked far more often. Tuned to ~5 blocks per team-game. Blocks only label a miss; they
 * never change whether the shot went in (they do change who's likely to get the rebound).
 */
export const BASE_BLOCK_SHARE_OF_MISSES: Record<PlayType, number> = {
  drive: 0.265,
  cut: 0.13,
  postUp: 0.19,
  midRange: 0.064,
  three: 0.024,
  putback: 0.105,
}

/** Shots taken while being fouled go in far less often (an "and-one"). */
export const AND_ONE_MAKE_FACTOR = 0.45

// ---------------------------------------------------------------------------------------------
// Turnovers
// ---------------------------------------------------------------------------------------------

/**
 * Chance the ball handler loses it (lost ball, or a bad pass when he gives it up) on a set.
 * Together with the shooter-phase rates and offensive fouls, tuned to ~13 turnovers per 100
 * possessions.
 */
export const BASE_HANDLER_TURNOVER = 0.075
/**
 * Chance the shooter turns it over on his own move, by play type: strips on drives and post
 * moves are common, catch-and-shoot jumpers almost never go wrong.
 */
export const BASE_SHOOTER_TURNOVER: Record<PlayType, number> = {
  drive: 0.055,
  cut: 0.03,
  postUp: 0.06,
  midRange: 0.015,
  three: 0.01,
  putback: 0.025,
}
/**
 * Share of handler turnovers that are steals (the rest are passes or dribbles out of bounds).
 * High: a bad pass or a loose dribble is usually picked off. Tuned with the shooter share to
 * ~7.5 steals per team-game.
 */
export const HANDLER_STEAL_SHARE = 0.74
/** Share of shooter-phase turnovers that are steals (travels and fumbles out of bounds aren't). */
export const SHOOTER_STEAL_SHARE = 0.5
/** On a bad pass, chance the steal comes from the receiver's defender jumping the lane. */
export const PASSING_LANE_STEAL_SHARE = 0.5

// ---------------------------------------------------------------------------------------------
// Fouls
// ---------------------------------------------------------------------------------------------

/**
 * How much the shooter's Aggression and the defender's Discipline move the shooting-foul
 * chance. One weight for both sides, for the same invariance reason as the edge weights.
 */
export const FOUL_EDGE_WEIGHT = 0.6
/**
 * How much a defender's own Aggression (more) vs. Discipline (fewer) moves his non-shooting
 * foul chance. Lower than FOUL_EDGE_WEIGHT: Aggression is an offensive attribute, so a heavy
 * weight here made "+3 offense" teams pay for it on defense and pushed the offense:defense
 * value ratio below 1.3.
 */
export const NON_SHOOTING_FOUL_TEMPER_WEIGHT = 0.3
/**
 * Chance of a defensive non-shooting foul (reach-in, holding, blocking) per set. Tuned with the
 * shooting-foul rates to ~20 personal fouls per team-game.
 */
export const BASE_NON_SHOOTING_FOUL = 0.086
/**
 * How much a handler who can beat his man (Driving/Quickness vs. Perimeter Defense/Quickness)
 * forces extra non-shooting fouls. Smaller than the temperament weight: fouling is mostly about
 * the defender's own habits.
 */
export const NON_SHOOTING_FOUL_MATCHUP_WEIGHT = 0.3
/** Share of non-shooting fouls committed on the ball handler (the rest are off the ball). */
export const ON_BALL_FOUL_SHARE = 0.65
/** Chance the ball handler commits an offensive foul (push-off, moving screen in the action). */
export const BASE_HANDLER_OFFENSIVE_FOUL = 0.006
/**
 * Chance the shooter commits an offensive foul on his move, by play type: charges on drives and
 * post-ups; almost never on a jumper.
 */
export const BASE_CHARGE: Record<PlayType, number> = {
  drive: 0.035,
  cut: 0.012,
  postUp: 0.03,
  midRange: 0.004,
  three: 0.002,
  putback: 0.01,
}
/** How much an attacker's Aggression (vs. his Offensive IQ) raises his offensive-foul chance. */
export const OFFENSIVE_FOUL_EDGE_WEIGHT = 0.5
/** How much the defender's Defensive IQ (vs. the attacker's Ball Handling) draws charges. */
export const CHARGE_DRAW_WEIGHT = 0.4

/**
 * Chance a player called for a foul also gets a technical (arguing the call). Tuned to ~0.6
 * technicals per team-game.
 */
export const BASE_TECHNICAL_PER_FOUL = 0.025
/** How much (hidden) Temperament calms a player down (log-odds per normalized rating). */
export const TECHNICAL_TEMPERAMENT_WEIGHT = 1.0
/** How much Discipline helps him keep quiet. Smaller: temperament is the main driver. */
export const TECHNICAL_DISCIPLINE_WEIGHT = 0.5
/** Extra log-odds of a technical in a tense game (close and late). */
export const TECHNICAL_CLOSE_GAME_EDGE = 0.5
/** Extra log-odds of a technical for a player one foul from disqualification. */
export const TECHNICAL_FOUL_TROUBLE_EDGE = 0.4
/** A "tense" game: the last this-many seconds of the final period or overtime... */
export const TENSE_SECONDS = 300
/** ...with the score within this many points. */
export const TENSE_MARGIN = 6

// ---------------------------------------------------------------------------------------------
// Rebounds and putbacks
// ---------------------------------------------------------------------------------------------

/** Chance the offense rebounds its own missed field goal (real ORB% ≈ 24–25%). */
export const BASE_OFFENSIVE_REBOUND = 0.25
/** Chance the offense rebounds its own missed final free throw (much lower: defenders have inside position). */
export const FREE_THROW_OFFENSIVE_REBOUND = 0.12
/** Chance the offense recovers its own blocked shot (when it stays in bounds): the blocker's team is closer. */
export const BLOCKED_SHOT_OFFENSIVE_REBOUND = 0.2
/** Share of blocks that go out of bounds, so the offense keeps the ball (a team rebound). */
export const BLOCK_OUT_OF_BOUNDS = 0.25
/** Log-odds per extra player on the floor in the rebounding battle (short-handed lineups). */
export const NUMBERS_REBOUND_EDGE = 0.3
/**
 * How much each 15 cm of height raises a player's share of their team's rebounds (relative
 * weight). 0.3 gives a starting big ~15 boards in 48 minutes and guards ~6–7.
 */
export const REBOUND_HEIGHT_FACTOR = 0.3
/**
 * Chance the offensive rebounder goes straight back up instead of kicking it out. Real
 * second-chance shots are mostly immediate putbacks.
 */
export const BASE_PUTBACK = 0.6
/** How much the rebounder's putback skill raises that chance (log-odds per normalized rating). */
export const PUTBACK_SKILL_WEIGHT = 1
/** How much each 15 cm of height raises it: bigs go back up, guards on long rebounds reset. */
export const PUTBACK_HEIGHT_WEIGHT = 0.6

// ---------------------------------------------------------------------------------------------
// Fast breaks
// ---------------------------------------------------------------------------------------------

/** Chance a steal starts a fast break (the defense is caught going the wrong way). */
export const STEAL_FAST_BREAK = 0.65
/** Chance a defensive recovery of a blocked shot starts a fast break. */
export const BLOCK_FAST_BREAK = 0.3
/** Chance an ordinary defensive rebound starts a fast break (the defense usually gets back). */
export const DEFENSIVE_REBOUND_FAST_BREAK = 0.17
/** How much the runners' Speed vs. the retreating defense's Speed/Hustle moves the fast-break chance. */
export const FAST_BREAK_SPEED_WEIGHT = 1.5
/** Chance a fast break has a numbers advantage (2-on-1, 3-on-2) for evenly fast teams. */
export const BASE_OUTNUMBERED = 0.35
/** How much the speed edge moves the numbers-advantage chance. */
export const OUTNUMBERED_SPEED_WEIGHT = 1.5
/** Log-odds bonus on every fast-break shot: the defense isn't set. */
export const TRANSITION_SHOT_EDGE = 0.35
/** Extra log-odds bonus when the offense outnumbers the defense. */
export const OUTNUMBERED_SHOT_EDGE = 0.5
/** Share of the normal help defense that's back in time on a fast break without a numbers edge. */
export const TRANSITION_HELP_FACTOR = 0.4
/** Extra log-odds of a shooting foul on a fast break: late-arriving defenders foul more (and-ones). */
export const TRANSITION_FOUL_EDGE = 0.3

/** Log-odds per extra offensive player on the floor when the defense is short-handed (FIBA). */
export const SHORTHANDED_SHOT_EDGE = 0.25

// ---------------------------------------------------------------------------------------------
// Free throws
// ---------------------------------------------------------------------------------------------

/** Free-throw percentage for a league-average shooter (real league ≈ 78%). */
export const BASE_FREE_THROW = 0.78
/** Free-throw percentage gained per rating point above average (and lost per point below). */
export const FREE_THROW_PER_RATING_POINT = 0.018
/**
 * Free-throw percentage swing from Composure in clutch time, at the ends of the scale
 * (Composure 20 = +5 points, Composure 1 = −5). Symmetric, so league FT% doesn't move.
 */
export const CLUTCH_FREE_THROW_SWING = 0.05

// ---------------------------------------------------------------------------------------------
// Edge weights and situational effects
// ---------------------------------------------------------------------------------------------

/**
 * How much the offensive player's skill moves the outcome (log-odds per normalized rating).
 * 0.75 means an elite scorer (rating 18) vs. an average defender gains ~0.6 log-odds, e.g. a
 * three goes from the ~33% base to ~47% on an open look, before considering defense.
 */
export const OFFENSE_EDGE_WEIGHT = 0.75
/**
 * How much the defender's skill moves the outcome. Must equal OFFENSE_EDGE_WEIGHT so that a
 * league that gets uniformly better at both ends doesn't score more (see contest.ts). The
 * offense:defense value balance (~1.4 : 1) comes from the composite skill weights in ratings.ts,
 * not from unequal edge weights.
 */
export const DEFENSE_EDGE_WEIGHT = 0.75
/** How much the passer's Passing moves the assist chance on a make (label only). */
export const ASSIST_PASSING_WEIGHT = 0.5
/** Log-odds bonus per 15 cm of height advantage on shots near the basket and on rebounds. */
export const HEIGHT_EDGE_WEIGHT = 0.15
/**
 * Small shooting boost for the home team (familiarity). Together with the road-crowd penalty
 * below it's tuned so identical teams give the home side ≈ +1.3 points and ≈ 53% wins.
 */
export const HOME_SHOOTING_EDGE = 0.01
/**
 * Hostile-crowd penalty (log-odds) for a road player of average Composure, at both ends of the
 * floor (shots, contests, ball security).
 */
export const ROAD_CROWD_EDGE = 0.008
/**
 * How much Composure shields a road player from the crowd: exposure = 1 − SHIELD × norm(Composure),
 * so Composure 20 feels 20% of the penalty and Composure 1 about 180%.
 */
export const ROAD_COMPOSURE_SHIELD = 0.8
/**
 * Spread (standard deviation, log-odds) of game-day form for the least and most consistent
 * players. Applies to offense AND defense, so form adds variance without favouring either end.
 * 0.3 at Consistency 1 moves a 36% shooter to ~29% or ~43% on a 1-SD bad or good day.
 */
export const FORM_SD_AT_MIN_CONSISTENCY = 0.3
export const FORM_SD_AT_MAX_CONSISTENCY = 0.03
/**
 * Shape of the Consistency → spread curve (1 = linear). 2 puts an average player (10.5) at
 * ≈ 0.10, close to the old uniform roll's spread, so league-level randomness barely changes
 * while Consistency 1 vs. 20 differs by 10x.
 */
export const FORM_CURVE_EXPONENT = 2
/** Form is clamped at this many standard deviations (symmetric, so the mean stays 0). */
export const FORM_CLAMP_SDS = 2.5
/** How much Composure matters in clutch time (applies to shooters, handlers and defenders alike). */
export const CLUTCH_EDGE_WEIGHT = 0.2
/** Clutch time: the final this-many seconds of the last regulation period or overtime... */
export const CLUTCH_SECONDS = 120
/** ...with the score within this many points. */
export const CLUTCH_MARGIN = 5

// ---------------------------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------------------------

/**
 * Length of each kind of action in seconds: a minimum plus a random spread (the average of two
 * uniform rolls, so mid-length actions are most common). Capped by the shot clock.
 * - halfCourt: a full set from the backcourt (average ≈ 13.5 s); tuned for ≈ 99 possessions
 *   per team per 48 minutes.
 * - transition: a fast break is over in a few seconds.
 * - reset: a kick-out after an offensive rebound; sideOut: an inbound after a foul.
 * - putback: straight back up.
 */
export const ACTION_TIMING: Record<ActionKind, { min: number; spread: number }> = {
  halfCourt: { min: 5, spread: 19.4 },
  transition: { min: 2, spread: 5 },
  reset: { min: 2, spread: 12 },
  sideOut: { min: 2, spread: 12 },
  putback: { min: 0.5, spread: 3 },
}

/**
 * Log-odds penalty on a shot when the period clock runs out before the action would normally
 * finish, scaled by the share of the action that was cut off. 1.5 at the full cut turns a 36%
 * three into a ~12% heave. Without it, a possession with 1 second left got a full-quality shot,
 * which made holding for the last shot pointless.
 */
export const BUZZER_SHOT_PENALTY = 1.5

// ---------------------------------------------------------------------------------------------
// Late-game score effects (last regulation period and overtime)
// ---------------------------------------------------------------------------------------------

/** A leading team starts running clock in the final this-many seconds... */
export const MILK_WINDOW_SECONDS = 150
/** ...fully once it leads by this many points (partially for smaller leads)... */
export const MILK_FULL_LEAD = 6
/** ...using up to this share of the gap between a normal action and a near-violation one. */
export const MILK_MAX_SHARE = 0.8
/** Seconds left on the shot clock when a team milking the clock finally shoots. */
export const MILK_BUFFER_SECONDS = 3
/** A tied team holding for the last shot shoots with this many seconds left on the game clock. */
export const LAST_SHOT_BUFFER_SECONDS = 2
/** A team trailing by at least this many... */
export const HURRY_MIN_DEFICIT = 3
/** ...in the final this-many seconds plays faster... */
export const HURRY_WINDOW_SECONDS = 90
/** ...taking this fraction of a normal action's time. */
export const HURRY_FACTOR = 0.55
/** The trailing team fouls on purpose in the final this-many seconds... */
export const INTENTIONAL_FOUL_SECONDS = 60
/** ...when down by at least this many (down 1–3 it can still get a stop and score normally)... */
export const INTENTIONAL_FOUL_MIN_DEFICIT = 4
/** ...and at most this many (beyond that the game is effectively over). */
export const INTENTIONAL_FOUL_MAX_DEFICIT = 10
/** An intentional foul comes quickly: a minimum plus a random spread, in seconds. */
export const INTENTIONAL_FOUL_MIN_SECONDS = 1
export const INTENTIONAL_FOUL_SPREAD_SECONDS = 3
/** A team down by at least this many... */
export const THREE_HUNT_MIN_DEFICIT = 3
/** ...in the final this-many seconds favours threes... */
export const THREE_HUNT_WINDOW_SECONDS = 120
/** ...up to (1 + BOOST)× its normal three-point weight as the clock runs out. */
export const THREE_HUNT_BOOST = 3
