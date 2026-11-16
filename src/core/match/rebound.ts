import type { Player } from '../players/types.ts'
import { adjustProbability, normalizeRating } from '../shared/probability.ts'
import { pickWeighted } from '../shared/weighted.ts'
import { matchupEdge } from './contest.ts'
import { lineupFatigueEdge } from './fatigue.ts'
import { maybeFastBreak } from './fastBreak.ts'
import type { ActionOutcome } from './outcome.ts'
import { continueWith } from './outcome.ts'
import {
  defensiveReboundSkill,
  heightEdge,
  lineupAverage,
  offensiveReboundSkill,
  offensiveSkill,
} from './ratings.ts'
import type { GameState, TeamState } from './state.ts'
import { lineOf, log, shortName } from './state.ts'
import {
  BASE_OFFENSIVE_REBOUND,
  BASE_PUTBACK,
  BLOCK_FAST_BREAK,
  BLOCK_OUT_OF_BOUNDS,
  BLOCKED_SHOT_OFFENSIVE_REBOUND,
  DEFENSIVE_REBOUND_FAST_BREAK,
  FREE_THROW_OFFENSIVE_REBOUND,
  HEIGHT_EDGE_WEIGHT,
  NUMBERS_REBOUND_EDGE,
  PUTBACK_HEIGHT_WEIGHT,
  PUTBACK_SKILL_WEIGHT,
  REBOUND_HEIGHT_FACTOR,
  REBOUND_MIN_SIZE_FACTOR,
} from './tuning.ts'

/** What the rebound came off: a missed field goal, a blocked shot, or a missed free throw. */
export type ReboundSource = 'shot' | 'block' | 'freeThrow'

/** Base offensive-rebound chance for each kind of miss. */
const BASE_BY_SOURCE: Record<ReboundSource, number> = {
  shot: BASE_OFFENSIVE_REBOUND,
  block: BLOCKED_SHOT_OFFENSIVE_REBOUND,
  freeThrow: FREE_THROW_OFFENSIVE_REBOUND,
}

/** Chance a defensive rebound starts a fast break, by kind of miss. */
const FAST_BREAK_BY_SOURCE: Record<ReboundSource, number> = {
  shot: DEFENSIVE_REBOUND_FAST_BREAK,
  block: BLOCK_FAST_BREAK,
  // After a missed free throw every player is lined up on the lane: no running start.
  freeThrow: 0,
}

/**
 * The offense's offensive-rebounding setting on this miss (crash the glass or get back). Missed
 * free throws are excluded: everyone is lined up on the lane, so there's nothing to crash.
 */
function crashEdge(offense: TeamState, source: ReboundSource): number {
  return source === 'freeThrow' ? 0 : offense.tactics.effects.offensiveReboundEdge
}

/** Chance the offense gets the rebound, comparing both lineups' rebounding, size and numbers. */
export function offensiveReboundChance(
  offense: TeamState,
  defense: TeamState,
  source: ReboundSource,
): number {
  // Same equal-weight matchup edge as shots: offensive rebounding against defensive rebounding.
  const skillEdge = matchupEdge(
    lineupAverage(offense.onCourt, offensiveReboundSkill),
    lineupAverage(defense.onCourt, defensiveReboundSkill),
  )
  const sizeEdge =
    lineupAverage(offense.onCourt, heightEdge) - lineupAverage(defense.onCourt, heightEdge)
  // A short-handed lineup can't box out everyone.
  const numbers = NUMBERS_REBOUND_EDGE * (offense.onCourt.length - defense.onCourt.length)
  return adjustProbability(
    BASE_BY_SOURCE[source],
    skillEdge +
      HEIGHT_EDGE_WEIGHT * sizeEdge +
      numbers +
      crashEdge(offense, source) +
      // Tired boxers lose the board: the lineups' fatigue (negative) differences tilt it.
      (lineupFatigueEdge(offense) - lineupFatigueEdge(defense)),
  )
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
  /** Height multiplier on a player's rebounding weight, floored so nobody drops to zero. */
  const sizeFactor = (p: Player): number =>
    Math.max(REBOUND_MIN_SIZE_FACTOR, 1 + heightEdge(p) * REBOUND_HEIGHT_FACTOR)
  return pickWeighted(game.rng, lineup, (p) => skillOf(p) * sizeFactor(p))
}

/**
 * Chance the offensive rebounder goes straight back up (a putback) rather than kicking it out to
 * reset. Good finishers and big men go back up more; a guard who tracks down a long rebound
 * usually resets.
 */
export function putbackChance(rebounder: Player): number {
  const edge =
    PUTBACK_SKILL_WEIGHT * normalizeRating(offensiveSkill(rebounder, 'putback')) +
    PUTBACK_HEIGHT_WEIGHT * heightEdge(rebounder)
  return adjustProbability(BASE_PUTBACK, edge)
}

/** An offensive rebound: the rebounder puts it back or kicks it out. */
function offensiveRebound(game: GameState, offense: TeamState): ActionOutcome {
  const rebounder = pickRebounder(game, offense.onCourt, offensiveReboundSkill)
  lineOf(offense, rebounder).offensiveRebounds += 1
  log(game, offense, `${shortName(rebounder)} offensive rebound`)
  if (game.rng.chance(putbackChance(rebounder))) return continueWith({ kind: 'putback', rebounder })
  return continueWith({ kind: 'reset' })
}

/** A defensive rebound ends the possession and may start a fast break. */
function defensiveRebound(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  source: ReboundSource,
): ActionOutcome {
  const rebounder = pickRebounder(game, defense.onCourt, defensiveReboundSkill)
  lineOf(defense, rebounder).defensiveRebounds += 1
  const verb = source === 'block' ? 'recovers the block' : 'defensive rebound'
  log(game, defense, `${shortName(rebounder)} ${verb}`)
  // A team that crashed the glass has fewer players back when it loses the board.
  const crashed = offense.tactics.effects.allowedReboundBreakEdge
  const base = FAST_BREAK_BY_SOURCE[source]
  const fastBreak = maybeFastBreak(game, defense, offense, rebounder, base, crashed)
  return { over: true, turnover: false, fastBreak }
}

/** Resolves a miss: records the rebound and says whether (and how) the offense keeps the ball. */
export function resolveRebound(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  source: ReboundSource,
): ActionOutcome {
  // Some blocks are swatted out of bounds: the offense keeps it (a team rebound, no player's).
  if (source === 'block' && game.rng.chance(BLOCK_OUT_OF_BOUNDS)) {
    offense.teamRebounds += 1
    log(game, offense, `Out of bounds off the block; ${offense.team.name} keep possession`)
    return continueWith({ kind: 'reset' })
  }
  if (game.rng.chance(offensiveReboundChance(offense, defense, source))) {
    return offensiveRebound(game, offense)
  }
  return defensiveRebound(game, offense, defense, source)
}
