import type { Player } from '../players/types.ts'
import { normalizeRating } from '../shared/probability.ts'
import type { Rng } from '../shared/rng.ts'
import { bestRimProtector, defensiveSkill, heightEdge, rimProtectionSkill } from './ratings.ts'
import type { TeamState } from './state.ts'
import { matchupDefender } from './state.ts'
import { DEFENSE_EDGE_WEIGHT, HELP_SHARE, OFFENSE_EDGE_WEIGHT } from './tuning.ts'
import type { PlayType } from './types.ts'

/**
 * Shared contest logic: how the defense resists a given play. Used both when a shot is resolved
 * (shot.ts) and when the offense decides which play to run (playSelection.ts), so the two can
 * never disagree about who is a good defender.
 */

/** True for plays that finish near the basket, where the rim protector and size matter. */
export function isInsideShot(playType: PlayType): boolean {
  return HELP_SHARE[playType] > 0
}

/** The defenders who contest one play: the on-ball matchup and the lineup's rim protector. */
export interface Contesters {
  defender: Player
  rimProtector: Player
  /**
   * Multiplier on the help defender's share of the contest (1 = normal half-court help). Fast
   * breaks lower it: the rim protector often isn't back yet.
   */
  helpFactor?: number
}

/** Finds who contests a play run by `player`: their slot matchup plus the defense's best rim protector. */
export function findContesters(
  offense: TeamState,
  defense: TeamState,
  player: Player,
  helpFactor = 1,
): Contesters {
  return {
    defender: matchupDefender(offense, defense, player),
    rimProtector: bestRimProtector(defense.onCourt),
    helpFactor,
  }
}

/** Share of this play's contest that comes from the help defender (0 for jump shots). */
export function helpShare(playType: PlayType, helpFactor = 1): number {
  return HELP_SHARE[playType] * helpFactor
}

/** Blends an on-ball value and a help-defender value by how much help matters for this play. */
export function blendByHelp(
  playType: PlayType,
  onBall: number,
  help: number,
  helpFactor = 1,
): number {
  const share = helpShare(playType, helpFactor)
  return onBall * (1 - share) + help * share
}

/** How well the defense contests this play (1–20 scale), combining on-ball and help defense. */
export function contestSkill(contesters: Contesters, playType: PlayType): number {
  const onBall = defensiveSkill(contesters.defender, playType)
  const help = rimProtectionSkill(contesters.rimProtector)
  return blendByHelp(playType, onBall, help, contesters.helpFactor)
}

/** Effective height of the contest (in 15 cm units vs. 200 cm): the help defender's size counts too. */
export function contestHeight(contesters: Contesters, playType: PlayType): number {
  return blendByHelp(
    playType,
    heightEdge(contesters.defender),
    heightEdge(contesters.rimProtector),
    contesters.helpFactor,
  )
}

/**
 * Picks which contester is charged with a foul (or credited with drawing a charge) on this play,
 * in proportion to their share of the contest: on a drive the help rim protector is responsible
 * half the time, on a jumper never.
 */
export function pickContester(rng: Rng, contesters: Contesters, playType: PlayType): Player {
  const share = helpShare(playType, contesters.helpFactor)
  return rng.chance(share) ? contesters.rimProtector : contesters.defender
}

/**
 * The core matchup edge in log-odds: offensive skill minus defensive skill, both normalized.
 * The two weights are kept equal on purpose: if every player in the league got uniformly better
 * at both ends, the edges cancel and scoring stays put, instead of inflating like it would if the
 * offense's skill counted for more than the defense's.
 */
export function matchupEdge(offenseRating: number, defenseRating: number): number {
  return (
    OFFENSE_EDGE_WEIGHT * normalizeRating(offenseRating) -
    DEFENSE_EDGE_WEIGHT * normalizeRating(defenseRating)
  )
}
