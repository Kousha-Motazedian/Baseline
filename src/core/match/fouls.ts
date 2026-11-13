import type { Player } from '../players/types.ts'
import { adjustProbability, normalizeRating } from '../shared/probability.ts'
import { sitsForFouls, updateFoulTroubleBench } from './foulTrouble.ts'
import { disqualify, isDisqualified } from './lineup.ts'
import { containmentSkill, penetrationSkill } from './ratings.ts'
import type { GameState, TeamState } from './state.ts'
import { lineOf, log, matchupDefender, shortName } from './state.ts'
import { addTeamFoul, isInPenalty } from './teamFouls.ts'
import { maybeTechnical, technicalFreeThrow } from './technicals.ts'
import {
  CHARGE_DRAW_WEIGHT,
  NON_SHOOTING_FOUL_MATCHUP_WEIGHT,
  NON_SHOOTING_FOUL_TEMPER_WEIGHT,
  OFFENSIVE_FOUL_EDGE_WEIGHT,
} from './tuning.ts'

/**
 * Personal fouls: who commits them, how they count, and what they cost. Every defensive personal
 * foul (shooting, non-shooting, intentional) is a team foul; offensive fouls are team fouls only
 * where the league says so (FIBA yes, pro no).
 */

/**
 * What kind of personal foul this is: an ordinary defensive foul, an offensive foul, or an
 * intentional (tactical) foul.
 */
export type FoulKind = 'defensive' | 'offensive' | 'intentional'

/** True if this kind of foul counts toward the team-foul bonus under the league's rules. */
function countsAsTeamFoul(game: GameState, kind: FoulKind): boolean {
  return kind !== 'offensive' || game.rules.offensiveFoulsCountAsTeamFouls
}

/** After a personal foul: a foul-out on the limit, otherwise a chance of a technical. */
function afterPersonalFoul(game: GameState, team: TeamState, player: Player, kind: FoulKind): void {
  if (lineOf(team, player).personalFouls >= game.rules.personalFoulLimit) {
    disqualify(game, team, player, 'fouledOut', (p) => sitsForFouls(game, team, p))
    // A deliberate foul to stop the clock is never argued, so it never draws a technical.
  } else if (kind !== 'intentional') {
    maybeTechnical(game, team, player)
  }
}

/**
 * Records a personal foul by `player` and returns whether his team was already in the penalty
 * BEFORE this foul (so the caller knows if a non-shooting foul shoots free throws).
 *
 * Order matters for the play-by-play: the foul, then any foul-out, then any technical, then any
 * foul-trouble substitution (a foul is a dead ball, so the coach can sub).
 */
export function commitFoul(
  game: GameState,
  team: TeamState,
  player: Player,
  description: string,
  kind: FoulKind = 'defensive',
): boolean {
  const penalty = isInPenalty(game, team)
  if (countsAsTeamFoul(game, kind)) addTeamFoul(game, team)
  if (isDisqualified(team, player)) {
    // Pro no-bench rule: a disqualified player who had to stay on isn't charged another personal
    // foul; the team is charged a technical instead (one free throw for the opponent).
    log(game, team, `${description} on ${shortName(player)} (already disqualified: technical)`)
    technicalFreeThrow(game, team)
    return penalty
  }
  lineOf(team, player).personalFouls += 1
  log(game, team, `${description} on ${shortName(player)}`)
  afterPersonalFoul(game, team, player, kind)
  updateFoulTroubleBench(game, team)
  return penalty
}

/**
 * Chance a defender commits a non-shooting foul (reach-in, holding, blocking) on this action.
 * His own Aggression raises it and Discipline lowers it; a ball handler who can really get by
 * him (Driving/Quickness vs. his Perimeter Defense/Quickness) forces more of them. `caution` is
 * the defender's foul-trouble caution (zero or negative log-odds).
 */
export function nonShootingFoulChance(
  base: number,
  handler: Player,
  defender: Player,
  caution = 0,
): number {
  // Both terms are differences of an offensive-side and a defensive-side rating, so a league that
  // gets uniformly better doesn't foul more or less.
  const temper =
    normalizeRating(defender.attributes.aggression) -
    normalizeRating(defender.attributes.discipline)
  const pressure =
    normalizeRating(penetrationSkill(handler)) - normalizeRating(containmentSkill(defender))
  return adjustProbability(
    base,
    NON_SHOOTING_FOUL_TEMPER_WEIGHT * temper +
      NON_SHOOTING_FOUL_MATCHUP_WEIGHT * pressure +
      caution,
  )
}

/**
 * Chance an offensive player commits an offensive foul (charge, push-off, illegal screen).
 * Reckless attackers (high Aggression, low Offensive IQ) commit more; a defender with high
 * Defensive IQ draws more charges, while an attacker with good Ball Handling (body control)
 * avoids them. `caution` is the attacker's foul-trouble caution (zero or negative log-odds).
 */
export function offensiveFoulChance(
  base: number,
  attacker: Player,
  drawer: Player,
  caution = 0,
): number {
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
    OFFENSIVE_FOUL_EDGE_WEIGHT * reckless + CHARGE_DRAW_WEIGHT * positioning + caution,
  )
}

/** Play-by-play label for an on-ball or off-ball non-shooting foul. */
export function nonShootingFoulLabel(game: GameState, onBall: boolean): string {
  // Purely descriptive: the label doesn't change the outcome.
  const labels = onBall ? ['Reach-in foul', 'Blocking foul'] : ['Holding foul', 'Loose-ball foul']
  return game.rng.pick(labels)
}

/**
 * Who commits an intentional foul: the defender with the fewest fouls among those it won't foul
 * out (anyone eligible if nobody is that safe), preferring the target's own man on a tie. Picking
 * by fouls rotates the job around the lineup instead of piling every foul on one defender.
 */
export function intentionalFouler(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  target: Player,
): Player {
  const matchup = matchupDefender(offense, defense, target)
  /** Personal fouls a defender already has. */
  const fouls = (p: Player): number => lineOf(defense, p).personalFouls
  // A disqualified player who had to stay on would turn the foul into a technical: skip him.
  const eligible = defense.onCourt.filter((p) => !isDisqualified(defense, p))
  const safe = eligible.filter((p) => fouls(p) < game.rules.personalFoulLimit - 1)
  const pool = safe.length > 0 ? safe : eligible
  return pool.reduce<Player>(
    (best, p) => (fouls(p) < fouls(best) || (fouls(p) === fouls(best) && p === matchup) ? p : best),
    pool[0] ?? matchup,
  )
}
