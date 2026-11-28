/**
 * Tuning data for the coach's timeout decisions (docs/design/timeouts.md, section 3). Ratings are
 * on the 1-20 scale; times are real seconds of a 48-minute pro game and scale to the league's
 * period length at use. Calibration target: about 6 of 7 timeouts used per team-game.
 */

/** The late-game window (final period / overtime) where clock timeouts are considered, seconds. */
export const LATE_WINDOW_SECONDS = 300
/** The "advance the ball" window: the last two minutes, seconds. */
export const ADVANCE_WINDOW_SECONDS = 120
/** Last-possession window, seconds (a 24s shot clock plus a little). */
export const LAST_POSSESSION_SECONDS = 28
/** The late windows never exceed this share of the period (short FIBA/test periods). */
export const MAX_WINDOW_PERIOD_SHARE = 0.4

/** Trailing by more than this (in SDs of the remaining swing) the game is gone: no clock timeouts. */
export const HOPELESS_SAFETY = -2.5
/** Points of margin that still count as one-possession-ish for a last-possession timeout. */
export const LAST_POSSESSION_DEFICIT = 3
/** Trailing by up to this many points makes advancing the ball worthwhile. */
export const ADVANCE_MAX_DEFICIT = 8
/** A leading team calls one only to protect a lead of at most this, in the last seconds. */
export const LEADING_PROTECT_LEAD = 3
export const LEADING_PROTECT_SECONDS = 20
/** Chance a leading coach protects the lead with a timeout at such a moment. */
export const LEADING_PROTECT_CHANCE = 0.04

/** Chance of acting on a late-game moment, at Game Management 1 and 20. */
export const STOP_CLOCK_CHANCE_AT_GM_1 = 0.7
export const STOP_CLOCK_CHANCE_AT_GM_20 = 1
export const ADVANCE_CHANCE_AT_GM_1 = 0.15
export const ADVANCE_CHANCE_AT_GM_20 = 0.6
export const LAST_POSSESSION_CHANCE_AT_GM_1 = 0.75
export const LAST_POSSESSION_CHANCE_AT_GM_20 = 1
/** Chance a late timeout is simply forgotten, at Game Management 1 and 20 (shrinks with GM). */
export const FORGET_CHANCE_AT_GM_1 = 0.3
export const FORGET_CHANCE_AT_GM_20 = 0.02

/** Timeouts held back for the end during the game's early/middle part, at GM 1 and 20. */
export const MID_RESERVE_AT_GM_1 = 1
export const MID_RESERVE_AT_GM_20 = 4
/** Timeouts held back right before the late window (the final period), at GM 1 and 20. */
export const END_RESERVE_AT_GM_1 = 0
export const END_RESERVE_AT_GM_20 = 3

/** An opponent run (points) that makes the coach call a timeout, at GM 1 (impatient) and 20. */
export const RUN_LINE_AT_GM_1 = 6
export const RUN_LINE_AT_GM_20 = 10
/** Chance he calls one when the run line is crossed and he can spare it. */
export const RUN_CALL_CHANCE = 0.75

/** The lowest on-court energy that makes him call a rest timeout, at GM 1 and 20. */
export const REST_LOWEST_LINE_AT_GM_1 = 42
export const REST_LOWEST_LINE_AT_GM_20 = 28
/** Or the average on-court energy below this (any GM). */
export const REST_AVERAGE_LINE = 50
/** Chance he calls a rest timeout when tired and he can spare it. */
export const REST_CALL_CHANCE = 0.5
