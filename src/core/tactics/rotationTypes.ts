import type { Player } from '../players/types.ts'
import type { LeagueRules } from '../world/rules.ts'

/**
 * The rotation contract (docs/design/rotations.md, sections 2-4): the coach's pre-game plan and
 * the inputs/outputs of his in-game substitution decisions. Pure data; the logic is in
 * rotationPlan.ts and rotationSubs.ts, and rotation.ts re-exports everything.
 */

/** A coach's pre-game rotation plan. */
export interface RotationPlan {
  /** 5 ids in slot order (PG, SG, SF, PF, C). */
  starters: string[]
  /** Every roster id, by rotation priority (starters first). */
  order: string[]
  /** Planned seconds per player (0 = out of the rotation). */
  targetSeconds: Record<string, number>
  /** 5 ids for the end of close games, in slot order. */
  closers: string[]
}

/** The two coach attributes the in-game rotation decisions read (1-20). */
export interface RotationCoach {
  rotationManagement: number
  gameManagement: number
}

/** A league-average rotation coach; also what a team without a head coach uses. */
export const NEUTRAL_ROTATION_COACH: RotationCoach = {
  rotationManagement: 10.5,
  gameManagement: 10.5,
}

/** What the substitution logic knows about one player's game so far. Energy is 0-100. */
export interface PlayerGameStatus {
  energy: number
  secondsPlayed: number
  personalFouls: number
  disqualified: boolean
}

/** Everything the coach looks at when deciding substitutions at a dead ball. */
export interface SubstitutionContext {
  rules: LeagueRules
  period: number
  /** Seconds left in the period. */
  clock: number
  /** This team's score margin (negative = trailing). */
  lead: number
  /** Lead in standard deviations of the remaining scoring swing (negative = trailing). */
  leadSafety: number
  roster: readonly Player[]
  /** Ids in slot order. */
  onCourt: readonly string[]
  /** Every roster player's status. */
  status: Readonly<Record<string, PlayerGameStatus>>
  plan: RotationPlan
  coach: RotationCoach
}

/** One substitution: the player entering for whoever holds `slot`. */
export interface Substitution {
  slot: number
  incomingId: string
}

/** The GM's own rotation (section 4): used exactly, with no penalty. */
export interface RotationOverride {
  starters: string[]
  order: string[]
  targetSeconds: Record<string, number>
}
