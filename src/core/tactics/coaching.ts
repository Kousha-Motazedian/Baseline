import type { TeamCoaching } from '../match/types.ts'
import { clamp, normalizeRating } from '../shared/probability.ts'
import type { HeadCoach } from '../staff/types.ts'
import type { SystemSetting, TeamSystem } from './system.ts'
import { changedSettings, DEFENSIVE_SETTINGS, OFFENSIVE_SETTINGS } from './system.ts'
import {
  ADAPTABILITY_SHIELD,
  EXECUTION_EDGE,
  FAMILIARITY_PENALTY,
  TACTICAL_KNOWLEDGE_SHIELD,
} from './tuning.ts'

/**
 * Coaching inputs for one game: the system the team runs and how well its head coach executes it
 * (docs/design/coaches.md, sections 3–4). Reads only the coach's coaching attributes,
 * Adaptability and preferred system: never his Reputation, and never any player's CA.
 */

/** Execution edge from a 1–20 coaching attribute: zero at league average (10.5), ±EXECUTION_EDGE at the ends. */
export function executionEdge(coaching: number): number {
  return EXECUTION_EDGE * normalizeRating(coaching)
}

/** A 1–20 attribute as a 0 (at 1) … 1 (at 20) share. */
function share(rating: number): number {
  return clamp((rating - 1) / 19, 0, 1)
}

/**
 * The share of the familiarity penalty a coach actually suffers: 1 for a coach with no
 * Adaptability or Tactical Knowledge, 0.2 for 20 in both. Adaptability counts more because it is
 * his willingness to run someone else's system; knowledge is his ability to.
 */
export function familiarityExposure(coach: HeadCoach): number {
  return (
    1 -
    ADAPTABILITY_SHIELD * share(coach.hidden.adaptability) -
    TACTICAL_KNOWLEDGE_SHIELD * share(coach.attributes.tacticalKnowledge)
  )
}

/**
 * Log-odds lost on one side for running settings the coach doesn't prefer: each overridden
 * setting costs an equal share of FAMILIARITY_PENALTY (so overriding the whole side costs all of
 * it), scaled by his exposure. A subtraction rather than a shrinking of his bonus, so overriding
 * always costs something, even for a below-average coach whose bonus is negative.
 */
export function familiarityPenalty(
  coach: HeadCoach,
  overridden: readonly SystemSetting[],
  side: readonly SystemSetting[],
): number {
  const count = overridden.filter((setting) => side.includes(setting)).length
  return FAMILIARITY_PENALTY * (count / side.length) * familiarityExposure(coach)
}

/**
 * The engine's coaching inputs for a coach running `system` (his own preferred system, or the GM's
 * override). The rotation settings are ignored here: they belong to neither side and have no
 * engine effect yet.
 */
export function coachingInputs(coach: HeadCoach, system: TeamSystem): TeamCoaching {
  const overridden = changedSettings(system, coach.preferredSystem)
  return {
    system,
    offensiveExecution:
      executionEdge(coach.attributes.offensiveCoaching) -
      familiarityPenalty(coach, overridden, OFFENSIVE_SETTINGS),
    defensiveExecution:
      executionEdge(coach.attributes.defensiveCoaching) -
      familiarityPenalty(coach, overridden, DEFENSIVE_SETTINGS),
  }
}
