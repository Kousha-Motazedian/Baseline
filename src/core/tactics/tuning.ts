import type { PlayType } from '../match/types.ts'
import type { HelpPriority, PrimaryAction, ShotProfile } from './system.ts'

/**
 * Tuning data for team systems, fit and coaching. Effect sizes were measured with
 * `npm run sim:batch -- --systems` (see docs/design/coaches.md, "Implementation notes").
 * All edges are log-odds, like the rest of the engine.
 */

/** One number per play type. */
export type PlayTypeValues = Record<PlayType, number>

// --- Pace ------------------------------------------------------------------------------------

/**
 * Half-court set length multipliers. ±15% moves the team's possessions by about +7 (fast) and −6
 * (slow) per 48 minutes (half-court sets are most of a possession's clock; fast breaks and
 * putbacks keep their own length).
 */
export const FAST_PACE_SECONDS_FACTOR = 0.85
export const SLOW_PACE_SECONDS_FACTOR = 1.15
/**
 * Shot quality by pace. Pace's main trade is variance: more possessions favour the better team,
 * fewer give an underdog a chance. Patient sets get slightly better looks. A rushed-shot penalty
 * for fast teams was tried (−0.03, then −0.01) but cost far more net rating than intended
 * (shorter sets already lose late-clock looks), so fast pace pays only through variance and fit.
 */
export const FAST_PACE_QUALITY_EDGE = 0
export const SLOW_PACE_QUALITY_EDGE = 0.01

// --- Shot profile and primary action ---------------------------------------------------------

/**
 * Multipliers on each half-court play type's base share (putbacks are never chosen, so 1).
 * Shot profile and primary action multiply together. The neutral entries ('balanced',
 * 'driveAndKick') are all 1: the base mix is already the modern drive-and-kick league.
 */
export const PLAY_SHARE_FACTORS: Record<ShotProfile | PrimaryAction, PlayTypeValues> = {
  balanced: { drive: 1, cut: 1, postUp: 1, midRange: 1, three: 1, putback: 1 },
  driveAndKick: { drive: 1, cut: 1, postUp: 1, midRange: 1, three: 1, putback: 1 },
  // Threes replace mid-range jumpers and post-ups (the analytics trade).
  threeHeavy: { drive: 1, cut: 1, postUp: 0.8, midRange: 0.7, three: 1.3, putback: 1 },
  // Paint first: post-ups, drives and cuts; threes only when the ball comes back out.
  insideOut: { drive: 1.2, cut: 1.2, postUp: 1.4, midRange: 0.85, three: 0.8, putback: 1 },
  // Handler drives and pull-ups, the roll man's dives (cuts); fewer post touches.
  pickAndRoll: { drive: 1.15, cut: 1.2, postUp: 0.7, midRange: 1.15, three: 1, putback: 1 },
  // Feed the post; fewer drives and threes.
  postUps: { drive: 0.9, cut: 1, postUp: 1.6, midRange: 1, three: 0.95, putback: 1 },
  // Cuts and screens away from the ball: cutters and catch-and-shoot threes, fewer drives.
  offBall: { drive: 0.85, cut: 1.5, postUp: 0.9, midRange: 1, three: 1.1, putback: 1 },
}

/**
 * The volume rule's weight: the shot-quality edge on a play type is −weight × ln(share multiplier).
 * At 0.2 a 30% boost costs ≈ 0.05 log-odds (≈ 1.2 percentage points of FG%), which roughly cancels
 * the expected-points gain of the trade for an average roster, so a profile isn't a free buff.
 */
export const VOLUME_QUALITY_WEIGHT = 0.2

// --- Ball movement ---------------------------------------------------------------------------

/** What a ball-movement option does. */
export interface BallMovementEffect {
  /** Multiplier on the usage exponent (0.6): lower spreads shots around, higher feeds the star. */
  usageExponentFactor: number
  /** Log-odds on a made shot off a pass being assisted. */
  assistEdge: number
  /** Log-odds on the offense's handler-phase turnovers (every extra pass can be picked off). */
  handlerTurnoverEdge: number
  /** Log-odds on half-court shot quality (open looks from the extra pass vs. contested isos). */
  qualityEdge: number
}

/** Motion: better, more assisted, more evenly shared shots, at the price of more bad passes. */
export const MOTION: BallMovementEffect = {
  usageExponentFactor: 0.75,
  assistEdge: 0.4,
  handlerTurnoverEdge: 0.08,
  qualityEdge: 0.04,
}

/** Isolation: the best players shoot more and turn it over less, but their shots are harder. */
export const ISOLATION: BallMovementEffect = {
  usageExponentFactor: 1.25,
  assistEdge: -0.4,
  handlerTurnoverEdge: -0.08,
  qualityEdge: -0.04,
}

// --- Transition and offensive rebounding -----------------------------------------------------

/**
 * Push: more of its own fast breaks, but players leaking out leave it less balanced when it loses
 * the ball. Get back: the reverse. Both are tempo trades rather than free points.
 */
export const PUSH_BREAK_EDGE = 0.5
export const PUSH_ALLOWED_BREAK_EDGE = 0.25
export const GET_BACK_BREAK_EDGE = -0.5
export const GET_BACK_ALLOWED_BREAK_EDGE = -0.4

/**
 * Crashing the glass: more offensive rebounds, but more fast breaks allowed when the defense gets
 * the board (fewer players back). Getting back is the reverse. Not symmetric on purpose: measured
 * with mirror-image values, giving up offensive boards cost far more than the fast breaks it
 * prevented (−3.6 net vs. +1.2 for crashing), so getting back gives up fewer boards and stops more
 * breaks, which brings both options near even for an average roster.
 */
export const CRASH_OFFENSIVE_REBOUND_EDGE = 0.35
export const CRASH_REBOUND_BREAK_EDGE = 0.9
export const GET_BACK_OFFENSIVE_REBOUND_EDGE = -0.18
export const GET_BACK_REBOUND_BREAK_EDGE = -0.9

// --- Defensive pressure and help priority ----------------------------------------------------

/** What a defensive-pressure option does. */
export interface PressureEffect {
  forcedTurnoverEdge: number
  stealEdge: number
  nonShootingFoulEdge: number
  shootingFoulEdge: number
  /** Contest edge by play type (negative = the offense gains: blow-bys, open jumpers). */
  contestEdge: PlayTypeValues
}

/** Aggressive: more turnovers and steals, at the price of fouls and defenders beaten off the dribble. */
export const AGGRESSIVE_PRESSURE: PressureEffect = {
  forcedTurnoverEdge: 0.2,
  stealEdge: 0.25,
  nonShootingFoulEdge: 0.2,
  shootingFoulEdge: 0.1,
  contestEdge: { drive: -0.08, cut: -0.08, postUp: 0, midRange: 0, three: 0, putback: 0 },
}

/** Conservative (contain): fewer fouls and blow-bys, but fewer turnovers and more open jumpers. */
export const CONSERVATIVE_PRESSURE: PressureEffect = {
  forcedTurnoverEdge: -0.2,
  stealEdge: -0.25,
  nonShootingFoulEdge: -0.3,
  shootingFoulEdge: -0.1,
  contestEdge: { drive: 0.13, cut: 0.13, postUp: 0.03, midRange: -0.03, three: -0.03, putback: 0 },
}

/**
 * Help priority: where the help defense leans. Protecting the paint contests the rim harder and
 * leaves shooters more open; running shooters off the line is the reverse.
 */
export const HELP_CONTEST_EDGES: Record<HelpPriority, PlayTypeValues> = {
  balanced: { drive: 0, cut: 0, postUp: 0, midRange: 0, three: 0, putback: 0 },
  protectPaint: {
    drive: 0.08,
    cut: 0.08,
    postUp: 0.08,
    midRange: -0.03,
    three: -0.07,
    putback: 0.08,
  },
  runShooters: {
    drive: -0.07,
    cut: -0.07,
    postUp: -0.07,
    midRange: 0.03,
    three: 0.08,
    putback: -0.07,
  },
}

// --- Fit -------------------------------------------------------------------------------------

/**
 * Log-odds edge for a player with perfect fit (+1); a player with poor fit (−1) gets the negative.
 * Applied to his own actions at his end of the floor (offensive fit: his shots and ball security;
 * defensive fit: his contests and ball pressure), like game-day form. Calibrated so a perfectly
 * fitted lineup vs. a poorly fitted one (+1 vs. −1 everywhere) is worth about 3.5 points of net
 * rating per 100 possessions (user-approved target 3–4); see coaches.md for the measurement.
 */
export const FIT_EDGE = 0.02

/** Weight of the role part (vs. the attribute part) of a player's fit for one setting. */
export const FIT_ROLE_PART = 0.5

/**
 * How far below his best role a wanted role can be before the role part stops getting worse
 * (role-fit points). A player whose own role is wanted scores 0; one with no wanted role at all
 * bottoms out here, so one terrible template can't dominate.
 */
export const FIT_ROLE_GAP_FLOOR = 3

/**
 * Raw fit (role part + attribute part) is divided by this before clamping to ±1, so a player about
 * two standard deviations from typical is a "perfect" (or "poor") fit. Measured SD of raw fit over
 * generated players ≈ 0.85–1.3 (≈ 1.0 typical; see coaches.md).
 */
export const FIT_SCALE = 2

// --- Coach execution -------------------------------------------------------------------------

/**
 * Execution edge for a 20 in Offensive/Defensive Coaching (a 1 gets about the negative; 10.5 is
 * zero). Same size as FIT_EDGE: best vs. worst coach ≈ perfect vs. poor fit ≈ 3.5 net rating.
 * Why not bigger: one man on the sideline shouldn't outweigh the players he coaches, and the
 * design doc wants coaching to matter without turning bad rosters into good ones.
 */
export const EXECUTION_EDGE = 0.02

/**
 * Familiarity: log-odds lost on one side when EVERY setting on that side is overridden by a coach
 * with no Adaptability or Tactical Knowledge (as much as the gap between an average and a top
 * coach). Each overridden setting costs its side's share (1/6 of this on offense, 1/2 on defense).
 */
export const FAMILIARITY_PENALTY = 0.02

/**
 * How much Adaptability and Tactical Knowledge shield a coach from the familiarity penalty, at 20
 * (linear from 0 at 1). Together a 20/20 coach keeps 20% of the penalty: even an adaptable coach
 * runs someone else's system a little worse than his own.
 */
export const ADAPTABILITY_SHIELD = 0.5
export const TACTICAL_KNOWLEDGE_SHIELD = 0.3
