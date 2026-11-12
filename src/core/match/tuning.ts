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

/**
 * Relative frequency of each play type before player/defense fit is applied. Tuned so the
 * realized FGA mix lands near a modern pro league: ~40% threes, ~22% mid-range (incl. floaters
 * and short jumpers), and the rest at the rim or in the post.
 */
export const BASE_PLAY_SHARE: Record<PlayType, number> = {
  drive: 0.275,
  cut: 0.105,
  postUp: 0.09,
  midRange: 0.193,
  three: 0.337,
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
 * Chance an average shot goes in, by play type (before the matchup edge). Realized league
 * values come out ≈ drive .62, cut .69, post .50, mid .44, three .36.
 */
export const BASE_MAKE: Record<PlayType, number> = {
  drive: 0.61,
  cut: 0.68,
  postUp: 0.48,
  midRange: 0.405,
  three: 0.332,
}

/**
 * Chance a shot attempt draws a shooting foul, by play type. These are higher than real
 * shooting-foul rates on purpose: the engine has no non-shooting/bonus fouls yet, so shooting
 * fouls carry ALL free-throw trips, tuned to a realistic FTA/FGA (~.245).
 */
export const BASE_SHOOTING_FOUL: Record<PlayType, number> = {
  drive: 0.27,
  cut: 0.18,
  postUp: 0.23,
  midRange: 0.058,
  three: 0.022,
}

/**
 * Chance a made shot was assisted, by play type. Cuts and spot-up threes are almost always set
 * up by a pass; drives and post-ups are mostly self-created. Tuned to ~60% of FGM assisted.
 */
export const BASE_ASSIST: Record<PlayType, number> = {
  drive: 0.33,
  cut: 0.93,
  postUp: 0.38,
  midRange: 0.45,
  three: 0.84,
}

/**
 * Share of (unfouled) missed shots that were blocked, by play type. Shots near the rim get
 * blocked far more often. Tuned to ~5 blocks per team-game. Blocks only label a miss; they
 * never change whether the shot went in.
 */
export const BASE_BLOCK_SHARE_OF_MISSES: Record<PlayType, number> = {
  drive: 0.28,
  cut: 0.14,
  postUp: 0.21,
  midRange: 0.07,
  three: 0.026,
}

/**
 * Chance an action ends in a turnover. Applied per action (including second chances after an
 * offensive rebound), tuned to ~13 turnovers per 100 possessions.
 */
export const BASE_TURNOVER = 0.118
/**
 * Share of turnovers that are steals (the rest are bad passes out of bounds, travels, etc.).
 * Real leagues: a bit over half; tuned to ~7.5 steals per team-game.
 */
export const BASE_STEAL_SHARE = 0.56
/** Chance the offense rebounds its own missed field goal (real ORB% ≈ 24–25%). */
export const BASE_OFFENSIVE_REBOUND = 0.25
/** Chance the offense rebounds its own missed final free throw (much lower: defenders have inside position). */
export const FREE_THROW_OFFENSIVE_REBOUND = 0.12
/**
 * How much each 15 cm of height raises a player's share of their team's rebounds (relative
 * weight). 0.3 gives a starting big ~15 boards in 48 minutes and guards ~6–7.
 */
export const REBOUND_HEIGHT_FACTOR = 0.3
/** Free-throw percentage for a league-average shooter (real league ≈ 78%). */
export const BASE_FREE_THROW = 0.78
/** Free-throw percentage gained per rating point above average (and lost per point below). */
export const FREE_THROW_PER_RATING_POINT = 0.018
/** Shots taken while being fouled go in far less often (an "and-one"). */
export const AND_ONE_MAKE_FACTOR = 0.45

/**
 * How much the offensive player's skill moves the outcome (log-odds per normalized rating).
 * 0.75 means an elite scorer (rating 18) vs. an average defender gains ~0.6 log-odds, e.g. a
 * three goes from ~36% to ~50% on an open look, before considering defense.
 */
export const OFFENSE_EDGE_WEIGHT = 0.75
/**
 * How much the defender's skill moves the outcome. Must equal OFFENSE_EDGE_WEIGHT so that a
 * league that gets uniformly better at both ends doesn't score more (see contest.ts). The
 * offense:defense value balance (~1.4 : 1) comes from the composite skill weights in ratings.ts,
 * not from unequal edge weights.
 */
export const DEFENSE_EDGE_WEIGHT = 0.75
/**
 * How much the shooter's Aggression and the defender's Discipline move the shooting-foul
 * chance. One weight for both sides, for the same invariance reason as the edge weights.
 */
export const FOUL_EDGE_WEIGHT = 0.6
/** How much the teammates' average Passing moves the assist chance on a make (label only). */
export const ASSIST_PASSING_WEIGHT = 0.5
/** Log-odds bonus per 15 cm of height advantage on shots near the basket and on rebounds. */
export const HEIGHT_EDGE_WEIGHT = 0.15
/** Small shooting boost for the home team (crowd, familiarity); worth ~1 point per game. */
export const HOME_SHOOTING_EDGE = 0.03
/**
 * Maximum log-odds swing from a player's game-day form; inconsistent players swing more.
 * Applies to offense AND defense, so form adds variance without favouring either end.
 */
export const FORM_EDGE_MAX = 0.25
/** How much Composure matters in clutch time (applies to shooters, handlers and defenders alike). */
export const CLUTCH_EDGE_WEIGHT = 0.2
/** Clutch time: the final this-many seconds of the last regulation period or overtime... */
export const CLUTCH_SECONDS = 120
/** ...with the score within this many points. */
export const CLUTCH_MARGIN = 5

/**
 * Length of a first action in seconds: a minimum plus a random spread (average ≈ 13.9 s).
 * With putbacks after offensive rebounds and free throws taking no clock, this lands at ≈ 99
 * possessions per team per 48 minutes.
 */
export const POSSESSION_MIN_SECONDS = 4
export const POSSESSION_SPREAD_SECONDS = 19.8
/** A second-chance action after an offensive rebound is much quicker (average ≈ 6 s). */
export const PUTBACK_MIN_SECONDS = 1
export const PUTBACK_SPREAD_SECONDS = 10
