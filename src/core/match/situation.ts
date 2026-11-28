import type { Player } from '../players/types.ts'
import { normalizeRating } from '../shared/probability.ts'
import type { Contesters } from './contest.ts'
import { blendByHelp } from './contest.ts'
import { coachingEdge } from './coaching.ts'
import { fatigueEdge } from './fatigue.ts'
import type { CourtEnd, GameState, TeamState } from './state.ts'
import { isClutch } from './state.ts'
import {
  CLUTCH_EDGE_WEIGHT,
  CLUTCH_MARGIN,
  CLUTCH_SECONDS,
  ROAD_COMPOSURE_SHIELD,
  ROAD_CROWD_EDGE,
} from './tuning.ts'
import type { PlayType } from './types.ts'

/**
 * Situational modifiers (game-day form, clutch composure, the road crowd and fatigue). They apply
 * to BOTH ends of the floor: an offensive player's good day is offset by a defender's good day,
 * so neither side gets a systematic boost from these effects.
 */

/**
 * A player's game-day form at one end of the floor, as a log-odds edge (rolled at tip-off from
 * the hidden Consistency; offense and defense are separate rolls).
 */
export function formEdge(team: TeamState, player: Player, end: CourtEnd): number {
  return team.form.get(player.id)?.[end] ?? 0
}

/** A player's composure edge in clutch time (zero outside clutch time). */
export function clutchEdge(game: GameState, player: Player): number {
  if (!isClutch(game, CLUTCH_SECONDS, CLUTCH_MARGIN)) return 0
  return CLUTCH_EDGE_WEIGHT * normalizeRating(player.attributes.composure)
}

/**
 * The hostile-crowd penalty for a road player (zero at home). Composure shields against it: an
 * average player takes the full ROAD_CROWD_EDGE, a Composure-20 player only a fifth of it, a
 * Composure-1 player nearly twice as much.
 */
export function roadEdge(team: TeamState, player: Player): number {
  if (team.isHome) return 0
  const exposure = 1 - ROAD_COMPOSURE_SHIELD * normalizeRating(player.attributes.composure)
  return -ROAD_CROWD_EDGE * Math.max(0, exposure)
}

/**
 * Form, clutch composure, the road crowd, fatigue and coaching (execution plus system fit)
 * (and the drawn-up play after a timeout) for one player at one end of the floor: everything about today's situation. Coaching is added
 * last, so a team without coaching (edge exactly 0) gets bit-for-bit the old sum.
 */
export function personalEdge(
  game: GameState,
  team: TeamState,
  player: Player,
  end: CourtEnd,
): number {
  return (
    formEdge(team, player, end) +
    clutchEdge(game, player) +
    roadEdge(team, player) +
    fatigueEdge(team, player) +
    coachingEdge(team.tactics, player, end) +
    (team.afterTimeout?.edge ?? 0)
  )
}

/**
 * The defense's situational edge on a contested play. The help defender's form and composure
 * count in the same proportion as their share of the contest, so situational effects line up
 * with skill effects.
 */
export function contestSituationalEdge(
  game: GameState,
  defense: TeamState,
  contesters: Contesters,
  playType: PlayType,
): number {
  return blendByHelp(
    playType,
    personalEdge(game, defense, contesters.defender, 'defense'),
    personalEdge(game, defense, contesters.rimProtector, 'defense'),
    contesters.helpFactor,
  )
}
