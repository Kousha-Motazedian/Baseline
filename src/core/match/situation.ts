import type { Player } from '../players/types.ts'
import { normalizeRating } from '../shared/probability.ts'
import type { Contesters } from './contest.ts'
import { blendByHelp } from './contest.ts'
import type { GameState, TeamState } from './state.ts'
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
 * Situational modifiers (game-day form, clutch composure and the road crowd). They apply to BOTH ends of the
 * floor: an offensive player's good day is offset by a defender's good day, so neither side
 * gets a systematic boost from these effects.
 */

/** A player's game-day form as a log-odds edge (rolled at tip-off from the hidden Consistency). */
export function formEdge(team: TeamState, player: Player): number {
  return team.form.get(player.id) ?? 0
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

/** Form, clutch composure and the road crowd for one player: everything about today's situation. */
export function personalEdge(game: GameState, team: TeamState, player: Player): number {
  return formEdge(team, player) + clutchEdge(game, player) + roadEdge(team, player)
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
    personalEdge(game, defense, contesters.defender),
    personalEdge(game, defense, contesters.rimProtector),
    contesters.helpFactor,
  )
}
