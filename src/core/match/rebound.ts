import type { Player } from '../players/types.ts'
import { adjustProbability } from '../shared/probability.ts'
import { pickWeighted } from '../shared/weighted.ts'
import { matchupEdge } from './contest.ts'
import { defensiveReboundSkill, heightEdge, offensiveReboundSkill } from './ratings.ts'
import type { GameState, TeamState } from './state.ts'
import { lineOf, log, shortName } from './state.ts'
import {
  BASE_OFFENSIVE_REBOUND,
  FREE_THROW_OFFENSIVE_REBOUND,
  REBOUND_HEIGHT_FACTOR,
  HEIGHT_EDGE_WEIGHT,
} from './tuning.ts'

/** What happened at the end of an action: the offense keeps the ball, or possession changes. */
export type ActionOutcome = 'offensiveRebound' | 'possessionOver'

/** Average of a value across a lineup. */
function lineupAverage(lineup: readonly Player[], valueOf: (p: Player) => number): number {
  return lineup.reduce((sum, p) => sum + valueOf(p), 0) / lineup.length
}

/** Chance the offense gets the rebound, comparing both lineups' rebounding and size. */
export function offensiveReboundChance(
  offense: TeamState,
  defense: TeamState,
  afterFreeThrow: boolean,
): number {
  // Same equal-weight matchup edge as shots: offensive rebounding against defensive rebounding.
  const skillEdge = matchupEdge(
    lineupAverage(offense.onCourt, offensiveReboundSkill),
    lineupAverage(defense.onCourt, defensiveReboundSkill),
  )
  const sizeEdge =
    lineupAverage(offense.onCourt, heightEdge) - lineupAverage(defense.onCourt, heightEdge)
  const base = afterFreeThrow ? FREE_THROW_OFFENSIVE_REBOUND : BASE_OFFENSIVE_REBOUND
  return adjustProbability(base, skillEdge + HEIGHT_EDGE_WEIGHT * sizeEdge)
}

/** Picks which player grabs a rebound: better and taller rebounders get more of them. */
function pickRebounder(
  game: GameState,
  lineup: readonly Player[],
  skillOf: (p: Player) => number,
): Player {
  // Linear in skill, plus a height factor so a 7-footer out-rebounds a guard with equal skill.
  // (Squared skill with a stronger height factor gave starting bigs ~45% of their team's boards,
  // about 20 a game; linear lands them near the real ~30%.)
  const sizeFactor = (p: Player): number => Math.max(0.3, 1 + heightEdge(p) * REBOUND_HEIGHT_FACTOR)
  return pickWeighted(game.rng, lineup, (p) => skillOf(p) * sizeFactor(p))
}

/** Resolves a missed shot's rebound, records it, and says whether the offense keeps the ball. */
export function resolveRebound(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  afterFreeThrow: boolean,
): ActionOutcome {
  if (game.rng.chance(offensiveReboundChance(offense, defense, afterFreeThrow))) {
    const rebounder = pickRebounder(game, offense.onCourt, offensiveReboundSkill)
    lineOf(offense, rebounder).offensiveRebounds += 1
    log(game, offense, `${shortName(rebounder)} offensive rebound`)
    return 'offensiveRebound'
  }
  const rebounder = pickRebounder(game, defense.onCourt, defensiveReboundSkill)
  lineOf(defense, rebounder).defensiveRebounds += 1
  log(game, defense, `${shortName(rebounder)} defensive rebound`)
  return 'possessionOver'
}
