/**
 * Helpers for coaching tests: hand-built head coaches and teams running a given system.
 */
import type { MatchTeam, TeamCoaching } from '../../src/core/match/types.ts'
import type { CoachAttributes, HeadCoach } from '../../src/core/staff/types.ts'
import type { TeamSystem } from '../../src/core/tactics/system.ts'
import { BALANCED_SYSTEM } from '../../src/core/tactics/system.ts'

/** Options for a hand-built coach; anything omitted is average (10, reputation 50). */
export interface TestCoachOptions {
  attributes?: Partial<CoachAttributes>
  adaptability?: number
  reputation?: number
  preferredSystem?: TeamSystem
}

/** Builds a head coach with exact attributes. */
export function makeCoach(options: TestCoachOptions = {}): HeadCoach {
  return {
    id: 'coach-1',
    firstName: 'Test',
    lastName: 'Coach',
    age: 50,
    attributes: {
      offensiveCoaching: 10,
      defensiveCoaching: 10,
      tacticalKnowledge: 10,
      gameManagement: 10,
      rotationManagement: 10,
      playerEvaluation: 10,
      motivation: 10,
      playerDevelopment: 10,
      discipline: 10,
      worksWithYouth: 10,
      ...options.attributes,
    },
    hidden: { reputation: options.reputation ?? 50, adaptability: options.adaptability ?? 10 },
    archetype: 'motionOffense',
    preferredSystem: options.preferredSystem ?? BALANCED_SYSTEM,
    contract: null,
  }
}

/** Coaching inputs for a system with no execution edges (an average coach on his own system). */
export function systemOnly(system: TeamSystem): TeamCoaching {
  return { system, offensiveExecution: 0, defensiveExecution: 0 }
}

/** A copy of a team running `system` with average coaching; settings in `patch` override balanced. */
export function runningSystem(team: MatchTeam, patch: Partial<TeamSystem>): MatchTeam {
  return { ...team, coaching: systemOnly({ ...BALANCED_SYSTEM, ...patch }) }
}
