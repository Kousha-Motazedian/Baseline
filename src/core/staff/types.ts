import type { SystemArchetype, TeamSystem } from '../tactics/system.ts'

/** Coach attributes, each 1–20 (see docs/design/coaches.md). */
export interface CoachAttributes {
  offensiveCoaching: number
  defensiveCoaching: number
  tacticalKnowledge: number
  gameManagement: number
  rotationManagement: number
  playerEvaluation: number
  motivation: number
  playerDevelopment: number
  discipline: number
  worksWithYouth: number
}

/** Hidden coach attributes. */
export interface CoachHidden {
  /** What the league thinks of him, 1–100. Drives salary demands and AI hiring, never the sim. */
  reputation: number
  /** Willingness to run the GM's overridden settings, 1–20. */
  adaptability: number
}

/** A coach's contract. Salary is per season in the league's currency units. */
export interface CoachContract {
  salary: number
  yearsRemaining: number
}

/** A head coach. */
export interface HeadCoach {
  id: string
  firstName: string
  lastName: string
  age: number
  attributes: CoachAttributes
  hidden: CoachHidden
  archetype: SystemArchetype
  preferredSystem: TeamSystem
  /** Null = unemployed (in the coach pool). */
  contract: CoachContract | null
}
