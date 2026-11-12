import type { Player } from '../players/types.ts'
import { adjustProbability, normalizeRating } from '../shared/probability.ts'
import { retreatSkill } from './ratings.ts'
import { wantsToMilkClock } from './scoreEffects.ts'
import type { GameState, TeamState } from './state.ts'
import {
  BASE_OUTNUMBERED,
  FAST_BREAK_SPEED_WEIGHT,
  OUTNUMBERED_SPEED_WEIGHT,
  OUTNUMBERED_SHOT_EDGE,
  TRANSITION_FOUL_EDGE,
  TRANSITION_HELP_FACTOR,
  TRANSITION_SHOT_EDGE,
} from './tuning.ts'

/**
 * Fast breaks. A change of possession (steal, blocked shot recovered, defensive rebound) can
 * start a transition attack before the defense is set. Speed decides it at both ends: the
 * runners' Speed against the retreating defense's Speed and Hustle.
 */

/** A transition attack in progress. */
export interface FastBreak {
  /** True if the offense has a numbers advantage (2-on-1, 3-on-2): no help defense at all. */
  outnumbered: boolean
}

/** Average of a value across a lineup. */
function lineupAverage(lineup: readonly Player[], valueOf: (p: Player) => number): number {
  return lineup.reduce((sum, p) => sum + valueOf(p), 0) / lineup.length
}

/** Log-odds edge of the running team's Speed over the retreating team's Speed and Hustle. */
function speedEdge(runners: TeamState, retreat: TeamState): number {
  const run = lineupAverage(runners.onCourt, (p) => p.attributes.speed)
  const back = lineupAverage(retreat.onCourt, retreatSkill)
  return normalizeRating(run) - normalizeRating(back)
}

/** Chance a change of possession turns into a fast break, from a base rate for how it started. */
export function fastBreakChance(base: number, runners: TeamState, retreat: TeamState): number {
  return adjustProbability(base, FAST_BREAK_SPEED_WEIGHT * speedEdge(runners, retreat))
}

/**
 * Rolls for a fast break after `runners` win the ball. Returns the player who starts it (he
 * pushes the ball up), or undefined. A team protecting a late lead pulls it out instead.
 */
export function maybeFastBreak(
  game: GameState,
  runners: TeamState,
  retreat: TeamState,
  starter: Player,
  base: number,
): Player | undefined {
  if (wantsToMilkClock(game, runners)) return undefined
  return game.rng.chance(fastBreakChance(base, runners, retreat)) ? starter : undefined
}

/** Starts a transition attack: rolls whether the offense has a numbers advantage. */
export function startFastBreak(game: GameState, offense: TeamState, defense: TeamState): FastBreak {
  const chance = adjustProbability(
    BASE_OUTNUMBERED,
    OUTNUMBERED_SPEED_WEIGHT * speedEdge(offense, defense),
  )
  return { outnumbered: game.rng.chance(chance) }
}

/** How much of the normal help defense is back in time (0 when the offense is outnumbering). */
export function transitionHelpFactor(fastBreak: FastBreak): number {
  return fastBreak.outnumbered ? 0 : TRANSITION_HELP_FACTOR
}

/** The offense's log-odds bonus on a transition shot: the defense isn't set. */
export function transitionShotEdge(fastBreak: FastBreak | undefined): number {
  if (!fastBreak) return 0
  return TRANSITION_SHOT_EDGE + (fastBreak.outnumbered ? OUTNUMBERED_SHOT_EDGE : 0)
}

/** Extra log-odds of drawing a shooting foul in transition (defenders arrive late: more and-ones). */
export function transitionFoulEdge(fastBreak: FastBreak | undefined): number {
  return fastBreak ? TRANSITION_FOUL_EDGE : 0
}
