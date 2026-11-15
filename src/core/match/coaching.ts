import type { Player } from '../players/types.ts'
import type { SystemEffects } from '../tactics/effects.ts'
import { NEUTRAL_EFFECTS, systemEffects } from '../tactics/effects.ts'
import type { PlayerFit } from '../tactics/fit.ts'
import { isNeutralForFit, playerFit } from '../tactics/fit.ts'
import { FIT_EDGE } from '../tactics/tuning.ts'
import { BASE_PLAY_SHARE } from './tuning.ts'
import type { MatchTeam, PlayType } from './types.ts'

/**
 * A team's coaching as the engine uses it: the system's lever values, the coach's execution edges
 * and each player's fit, all worked out once at tip-off. A team without `coaching` gets neutral
 * tactics, which leave every engine step exactly as it was before systems existed (every hook adds
 * 0 or multiplies by 1, and none of them draws a random number).
 */
export interface TeamTactics {
  effects: SystemEffects
  /** Base half-court play shares after the system's multipliers. */
  halfCourtShares: Partial<Record<PlayType, number>>
  offensiveExecution: number
  defensiveExecution: number
  /** Fit per player id (players missing from the map have zero fit). */
  fit: ReadonlyMap<string, PlayerFit>
}

/** Tactics of a team with no coaching inputs: everything neutral. */
export const NEUTRAL_TACTICS: TeamTactics = {
  effects: NEUTRAL_EFFECTS,
  halfCourtShares: BASE_PLAY_SHARE,
  offensiveExecution: 0,
  defensiveExecution: 0,
  fit: new Map(),
}

/** The base half-court shares scaled by a system's play-type multipliers. */
function scaledShares(effects: SystemEffects): Partial<Record<PlayType, number>> {
  const shares: Partial<Record<PlayType, number>> = {}
  for (const [type, share] of Object.entries(BASE_PLAY_SHARE) as [PlayType, number][]) {
    shares[type] = share * effects.playShareFactors[type]
  }
  return shares
}

/** Every roster player's fit for the system (an empty map when the system asks nothing). */
function rosterFit(
  team: MatchTeam,
  coaching: NonNullable<MatchTeam['coaching']>,
): Map<string, PlayerFit> {
  if (isNeutralForFit(coaching.system)) return new Map()
  return new Map(team.roster.map((player) => [player.id, playerFit(player, coaching.system)]))
}

/** Works out a team's tactics for one game from its coaching inputs (neutral when absent). */
export function teamTactics(team: MatchTeam): TeamTactics {
  const coaching = team.coaching
  if (!coaching) return NEUTRAL_TACTICS
  const effects = systemEffects(coaching.system)
  return {
    effects,
    halfCourtShares: scaledShares(effects),
    offensiveExecution: coaching.offensiveExecution,
    defensiveExecution: coaching.defensiveExecution,
    fit: rosterFit(team, coaching),
  }
}

/**
 * The coaching edge on one player's actions at one end of the floor: his coach's execution edge
 * for that end plus his own fit. Applied wherever game-day form is (his shots, contests and ball
 * security, through situation.ts), because both describe how well he plays today rather than how
 * good he is.
 */
export function coachingEdge(
  tactics: TeamTactics,
  player: Player,
  end: 'offense' | 'defense',
): number {
  const execution = end === 'offense' ? tactics.offensiveExecution : tactics.defensiveExecution
  return execution + FIT_EDGE * (tactics.fit.get(player.id)?.[end] ?? 0)
}
