import type { Player } from '../players/types.ts'
import { normalizeRating } from '../shared/probability.ts'
import { bestRimProtector, defensiveSkill, heightEdge, rimProtectionSkill } from './ratings.ts'
import type { TeamState } from './state.ts'
import { matchupDefender } from './state.ts'
import { DEFENSE_EDGE_WEIGHT, OFFENSE_EDGE_WEIGHT } from './tuning.ts'
import type { PlayType } from './types.ts'

/**
 * Shared contest logic: how the defense resists a given play. Used both when a shot is resolved
 * (shot.ts) and when the offense decides which play to run (playSelection.ts), so the two can
 * never disagree about who is a good defender.
 */

/**
 * Share of the contest that comes from the help defender (the rim protector) rather than the
 * man guarding the ball. Drives and cuts end at the rim, where help arrives; post-ups are mostly
 * one-on-one; jump shots are contested only by the on-ball defender.
 */
const HELP_SHARE: Record<PlayType, number> = {
  drive: 0.5,
  cut: 0.5,
  postUp: 0.3,
  midRange: 0,
  three: 0,
}

/** True for plays that finish near the basket, where the rim protector and size matter. */
export function isInsideShot(playType: PlayType): boolean {
  return HELP_SHARE[playType] > 0
}

/** The defenders who contest one play: the on-ball matchup and the lineup's rim protector. */
export interface Contesters {
  defender: Player
  rimProtector: Player
}

/** Finds who contests a play run by `player`: their slot matchup plus the defense's best rim protector. */
export function findContesters(offense: TeamState, defense: TeamState, player: Player): Contesters {
  return {
    defender: matchupDefender(offense, defense, player),
    rimProtector: bestRimProtector(defense.onCourt),
  }
}

/** Blends an on-ball value and a help-defender value by how much help matters for this play. */
export function blendByHelp(playType: PlayType, onBall: number, help: number): number {
  const share = HELP_SHARE[playType]
  return onBall * (1 - share) + help * share
}

/** How well the defense contests this play (1–20 scale), combining on-ball and help defense. */
export function contestSkill(contesters: Contesters, playType: PlayType): number {
  const onBall = defensiveSkill(contesters.defender, playType)
  const help = rimProtectionSkill(contesters.rimProtector)
  return blendByHelp(playType, onBall, help)
}

/** Effective height of the contest (in 15 cm units vs. 200 cm): the help defender's size counts too. */
export function contestHeight(contesters: Contesters, playType: PlayType): number {
  return blendByHelp(playType, heightEdge(contesters.defender), heightEdge(contesters.rimProtector))
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
