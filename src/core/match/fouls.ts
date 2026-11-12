import type { Player } from '../players/types.ts'
import { adjustProbability, normalizeRating } from '../shared/probability.ts'
import { disqualify, isDisqualified } from './lineup.ts'
import { containmentSkill, penetrationSkill } from './ratings.ts'
import type { GameState, TeamState } from './state.ts'
import { lineOf, log, shortName } from './state.ts'
import { addTeamFoul, isInPenalty } from './teamFouls.ts'
import { maybeTechnical, technicalFreeThrow } from './technicals.ts'
import {
  CHARGE_DRAW_WEIGHT,
  NON_SHOOTING_FOUL_MATCHUP_WEIGHT,
  NON_SHOOTING_FOUL_TEMPER_WEIGHT,
  OFFENSIVE_FOUL_EDGE_WEIGHT,
} from './tuning.ts'

/**
 * Personal fouls: who commits them, how they count, and what they cost. Every personal foul
 * (shooting, non-shooting, offensive, intentional) is a team foul.
 */

/**
 * Records a personal foul by `player` and returns whether his team was already in the penalty
 * BEFORE this foul (so the caller knows if a non-shooting foul shoots free throws).
 *
 * Order matters for the play-by-play: the foul, then any foul-out, then any technical.
 */
export function commitFoul(
  game: GameState,
  team: TeamState,
  player: Player,
  description: string,
): boolean {
  const penalty = isInPenalty(game, team)
  addTeamFoul(game, team)
  if (isDisqualified(team, player)) {
    // Pro no-bench rule: a disqualified player who had to stay on isn't charged another personal
    // foul; the team is charged a technical instead (one free throw for the opponent).
    log(game, team, `${description} on ${shortName(player)} (already disqualified: technical)`)
    technicalFreeThrow(game, team)
    return penalty
  }
  const line = lineOf(team, player)
  line.personalFouls += 1
  log(game, team, `${description} on ${shortName(player)}`)
  if (line.personalFouls >= game.rules.personalFoulLimit)
    disqualify(game, team, player, 'fouledOut')
  else maybeTechnical(game, team, player)
  return penalty
}

/**
 * Chance a defender commits a non-shooting foul (reach-in, holding, blocking) on this action.
 * His own Aggression raises it and Discipline lowers it; a ball handler who can really get by
 * him (Driving/Quickness vs. his Perimeter Defense/Quickness) forces more of them.
 */
export function nonShootingFoulChance(base: number, handler: Player, defender: Player): number {
  // Both terms are differences of an offensive-side and a defensive-side rating, so a league that
  // gets uniformly better doesn't foul more or less.
  const temper =
    normalizeRating(defender.attributes.aggression) -
    normalizeRating(defender.attributes.discipline)
  const pressure =
    normalizeRating(penetrationSkill(handler)) - normalizeRating(containmentSkill(defender))
  return adjustProbability(
    base,
    NON_SHOOTING_FOUL_TEMPER_WEIGHT * temper + NON_SHOOTING_FOUL_MATCHUP_WEIGHT * pressure,
  )
}

/**
 * Chance an offensive player commits an offensive foul (charge, push-off, illegal screen).
 * Reckless attackers (high Aggression, low Offensive IQ) commit more; a defender with high
 * Defensive IQ draws more charges, while an attacker with good Ball Handling (body control)
 * avoids them.
 */
export function offensiveFoulChance(base: number, attacker: Player, drawer: Player): number {
  // Both terms keep each end's attributes on its own side: the attacker's habits are offensive
  // attributes (so a better defense doesn't make its own offense foul less), and charge drawing
  // is Defensive IQ against an offensive skill (so a uniformly better league is unchanged).
  const reckless =
    normalizeRating(attacker.attributes.aggression) -
    normalizeRating(attacker.attributes.offensiveIq)
  const positioning =
    normalizeRating(drawer.attributes.defensiveIq) -
    normalizeRating(attacker.attributes.ballHandling)
  return adjustProbability(
    base,
    OFFENSIVE_FOUL_EDGE_WEIGHT * reckless + CHARGE_DRAW_WEIGHT * positioning,
  )
}

/** Play-by-play label for an on-ball or off-ball non-shooting foul. */
export function nonShootingFoulLabel(game: GameState, onBall: boolean): string {
  // Purely descriptive: the label doesn't change the outcome.
  const labels = onBall ? ['Reach-in foul', 'Blocking foul'] : ['Holding foul', 'Loose-ball foul']
  return game.rng.pick(labels)
}
