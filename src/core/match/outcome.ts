import type { Player } from '../players/types.ts'

/**
 * How one action ends. Either the offense keeps the ball and runs another action of a given
 * kind, or the possession is over (and may hand the other team a fast break).
 */

/** The next action when the offense keeps the ball. */
export type NextAction =
  /** The offensive rebounder goes straight back up with it. */
  | { kind: 'putback'; rebounder: Player }
  /** Offensive rebound kicked back out: the offense resets and runs a quick set. */
  | { kind: 'reset' }
  /** Inbound after a defensive foul without free throws (or a block out of bounds). */
  | { kind: 'sideOut' }

/** The kinds of action, each with its own typical length (see ACTION_TIMING in tuning.ts). */
export type ActionKind = 'halfCourt' | 'transition' | NextAction['kind']

/** What happened at the end of an action. */
export type ActionOutcome =
  | { over: false; next: NextAction }
  | {
      over: true
      /** True if the possession ended in a turnover (for points off turnovers). */
      turnover: boolean
      /** The player starting a fast break the other way, if the change of possession allows one. */
      fastBreak: Player | undefined
    }

/** The possession ended without a turnover and without a fast break the other way. */
export function possessionOver(): ActionOutcome {
  return { over: true, turnover: false, fastBreak: undefined }
}

/** The offense keeps the ball and runs `next`. */
export function continueWith(next: NextAction): ActionOutcome {
  return { over: false, next }
}
