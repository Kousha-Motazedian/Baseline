import type { PlayType } from '../match/types.ts'
import type { TeamSystem } from './system.ts'
import {
  AGGRESSIVE_PRESSURE,
  CONSERVATIVE_PRESSURE,
  CRASH_OFFENSIVE_REBOUND_EDGE,
  CRASH_REBOUND_BREAK_EDGE,
  FAST_PACE_QUALITY_EDGE,
  FAST_PACE_SECONDS_FACTOR,
  GET_BACK_ALLOWED_BREAK_EDGE,
  GET_BACK_BREAK_EDGE,
  GET_BACK_OFFENSIVE_REBOUND_EDGE,
  GET_BACK_REBOUND_BREAK_EDGE,
  HELP_CONTEST_EDGES,
  ISOLATION,
  MOTION,
  PLAY_SHARE_FACTORS,
  PUSH_ALLOWED_BREAK_EDGE,
  PUSH_BREAK_EDGE,
  SLOW_PACE_QUALITY_EDGE,
  SLOW_PACE_SECONDS_FACTOR,
  VOLUME_QUALITY_WEIGHT,
} from './tuning.ts'
import type { BallMovementEffect, PlayTypeValues, PressureEffect } from './tuning.ts'

/**
 * System effects: what a team's system does to the match engine's existing levers. Everything is
 * plain numbers the engine adds (log-odds edges) or multiplies (factors), so the engine stays a
 * set of small hooks. Every lever is neutral (edge 0, factor 1) for the 'balanced' option, so
 * BALANCED_SYSTEM reproduces today's engine exactly.
 *
 * Each option is a trade-off, never a free buff: it buys something at a price (more threes but
 * worse ones, more steals but more fouls, more offensive rebounds but more fast breaks allowed).
 * The win comes from FIT (fit.ts): a roster built for the system makes the trade pay.
 */
export interface SystemEffects {
  /** Multiplier on the length of half-court sets (pace). */
  setSecondsFactor: number
  /** Multiplier on each half-court play type's base share (shot profile x primary action). */
  playShareFactors: PlayTypeValues
  /** Offense's log-odds edge on its own half-court shots, by play type. */
  shotQualityEdge: PlayTypeValues
  /** Multiplier on the engine's usage exponent (ball movement: lower spreads the shots). */
  usageExponentFactor: number
  /** Log-odds edge on the chance a made shot off a pass is assisted (ball movement). */
  assistEdge: number
  /** Log-odds edge on the offense's own handler-phase turnovers (more passes, more bad passes). */
  handlerTurnoverEdge: number
  /** Log-odds edge on this team starting fast breaks when it wins the ball (transition). */
  fastBreakEdge: number
  /** Log-odds edge on the opponent's fast breaks against this team (transition balance). */
  allowedFastBreakEdge: number
  /** Log-odds edge on this team's offensive rebound chance (crashing the glass). */
  offensiveReboundEdge: number
  /** Extra log-odds edge on the opponent's fast breaks after it rebounds this team's miss. */
  allowedReboundBreakEdge: number
  /** Defense's log-odds contest edge by play type, taken off the opponent's make chance. */
  contestEdge: PlayTypeValues
  /** Log-odds edge on the opponent's turnovers (ball pressure). */
  forcedTurnoverEdge: number
  /** Log-odds edge on a forced turnover being a steal. */
  stealEdge: number
  /** Log-odds edge on this defense's non-shooting fouls. */
  nonShootingFoulEdge: number
  /** Log-odds edge on this defense's shooting fouls. */
  shootingFoulEdge: number
}

/** A value of `value` for every play type. */
function everyPlay(value: number): PlayTypeValues {
  return { drive: value, cut: value, postUp: value, midRange: value, three: value, putback: value }
}

/** Effects of the balanced system: every lever neutral. */
export const NEUTRAL_EFFECTS: SystemEffects = {
  setSecondsFactor: 1,
  playShareFactors: everyPlay(1),
  shotQualityEdge: everyPlay(0),
  usageExponentFactor: 1,
  assistEdge: 0,
  handlerTurnoverEdge: 0,
  fastBreakEdge: 0,
  allowedFastBreakEdge: 0,
  offensiveReboundEdge: 0,
  allowedReboundBreakEdge: 0,
  contestEdge: everyPlay(0),
  forcedTurnoverEdge: 0,
  stealEdge: 0,
  nonShootingFoulEdge: 0,
  shootingFoulEdge: 0,
}

/** Two per-play-type tables combined entry by entry. */
function combine(
  a: PlayTypeValues,
  b: PlayTypeValues,
  op: (x: number, y: number) => number,
): PlayTypeValues {
  const out = { ...a }
  for (const key of Object.keys(out) as PlayType[]) out[key] = op(a[key], b[key])
  return out
}

/** Share multipliers from the shot profile and the primary action, combined. */
function playShareFactors(system: TeamSystem): PlayTypeValues {
  const profile = PLAY_SHARE_FACTORS[system.shotProfile]
  const action = PLAY_SHARE_FACTORS[system.primaryAction]
  return combine(profile, action, (x, y) => x * y)
}

/**
 * The volume rule: forcing more of a play type means taking its worse looks too, and taking
 * fewer of one means only its best looks remain. Log of the share multiplier, so doubling and
 * halving cost and gain the same. This is what keeps shot profile and primary action trade-offs:
 * a three-heavy team takes more threes, but its extra threes are slightly worse ones.
 */
function volumeQualityEdge(factors: PlayTypeValues): PlayTypeValues {
  return combine(factors, factors, (factor) => -VOLUME_QUALITY_WEIGHT * Math.log(factor))
}

/** Pace's effect on shot quality: a slow team works for slightly better looks (see tuning.ts). */
function paceQualityEdge(system: TeamSystem): number {
  if (system.pace === 'fast') return FAST_PACE_QUALITY_EDGE
  if (system.pace === 'slow') return SLOW_PACE_QUALITY_EDGE
  return 0
}

/** Pace's multiplier on half-court set length. */
function paceSecondsFactor(system: TeamSystem): number {
  if (system.pace === 'fast') return FAST_PACE_SECONDS_FACTOR
  if (system.pace === 'slow') return SLOW_PACE_SECONDS_FACTOR
  return 1
}

/** The ball-movement option's effect (undefined for balanced). */
function ballMovementEffect(system: TeamSystem): BallMovementEffect | undefined {
  if (system.ballMovement === 'motion') return MOTION
  if (system.ballMovement === 'isolation') return ISOLATION
  return undefined
}

/** Offense's shot-quality edge by play type: volume rule, pace and ball movement. */
function shotQualityEdge(system: TeamSystem, factors: PlayTypeValues): PlayTypeValues {
  const flat = paceQualityEdge(system) + (ballMovementEffect(system)?.qualityEdge ?? 0)
  const edges = combine(volumeQualityEdge(factors), everyPlay(flat), (x, y) => x + y)
  // Putbacks aren't a chosen play: no volume rule, no set to run.
  return { ...edges, putback: 0 }
}

/** The defensive-pressure option's effect (undefined for balanced). */
function pressureEffect(system: TeamSystem): PressureEffect | undefined {
  if (system.defensivePressure === 'aggressive') return AGGRESSIVE_PRESSURE
  if (system.defensivePressure === 'conservative') return CONSERVATIVE_PRESSURE
  return undefined
}

/** Defense's contest edge by play type: help priority plus pressure (blow-bys, sagging). */
function contestEdge(system: TeamSystem): PlayTypeValues {
  const help = HELP_CONTEST_EDGES[system.helpPriority]
  const pressure = pressureEffect(system)?.contestEdge ?? everyPlay(0)
  return combine(help, pressure, (x, y) => x + y)
}

/** Fast-break edges (own breaks, breaks allowed) from the transition setting. */
function transitionEdges(system: TeamSystem): { own: number; allowed: number } {
  if (system.transition === 'push')
    return { own: PUSH_BREAK_EDGE, allowed: PUSH_ALLOWED_BREAK_EDGE }
  if (system.transition === 'getBack') {
    return { own: GET_BACK_BREAK_EDGE, allowed: GET_BACK_ALLOWED_BREAK_EDGE }
  }
  return { own: 0, allowed: 0 }
}

/** Offensive-rebounding edges (own boards, breaks allowed after a lost board). */
function reboundingEdges(system: TeamSystem): { board: number; breaks: number } {
  if (system.offensiveRebounding === 'crash') {
    return { board: CRASH_OFFENSIVE_REBOUND_EDGE, breaks: CRASH_REBOUND_BREAK_EDGE }
  }
  if (system.offensiveRebounding === 'getBack') {
    return { board: GET_BACK_OFFENSIVE_REBOUND_EDGE, breaks: GET_BACK_REBOUND_BREAK_EDGE }
  }
  return { board: 0, breaks: 0 }
}

/** Every engine lever for a system. The rotation settings have no effect yet (no rotations). */
export function systemEffects(system: TeamSystem): SystemEffects {
  const factors = playShareFactors(system)
  const movement = ballMovementEffect(system)
  const pressure = pressureEffect(system)
  const transition = transitionEdges(system)
  const rebounding = reboundingEdges(system)
  return {
    setSecondsFactor: paceSecondsFactor(system),
    playShareFactors: factors,
    shotQualityEdge: shotQualityEdge(system, factors),
    usageExponentFactor: movement?.usageExponentFactor ?? 1,
    assistEdge: movement?.assistEdge ?? 0,
    handlerTurnoverEdge: movement?.handlerTurnoverEdge ?? 0,
    fastBreakEdge: transition.own,
    allowedFastBreakEdge: transition.allowed,
    offensiveReboundEdge: rebounding.board,
    allowedReboundBreakEdge: rebounding.breaks,
    contestEdge: contestEdge(system),
    forcedTurnoverEdge: pressure?.forcedTurnoverEdge ?? 0,
    stealEdge: pressure?.stealEdge ?? 0,
    nonShootingFoulEdge: pressure?.nonShootingFoulEdge ?? 0,
    shootingFoulEdge: pressure?.shootingFoulEdge ?? 0,
  }
}
