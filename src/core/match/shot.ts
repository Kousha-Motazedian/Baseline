import type { Player } from '../players/types.ts'
import { adjustProbability, normalizeRating } from '../shared/probability.ts'
import { describeShot } from './describe.ts'
import type { FastBreak } from './fastBreak.ts'
import { transitionFoulEdge, transitionShotEdge } from './fastBreak.ts'
import { foulCautionEdge } from './foulTrouble.ts'
import { commitFoul } from './fouls.ts'
import { shootFreeThrows } from './freeThrows.ts'
import type { Contesters } from './contest.ts'
import {
  blendByHelp,
  contestHeight,
  contestSkill,
  isInsideShot,
  matchupEdge,
  pickContester,
} from './contest.ts'
import type { ActionOutcome } from './outcome.ts'
import { possessionOver } from './outcome.ts'
import { blockSkill, heightEdge, offensiveSkill } from './ratings.ts'
import { resolveRebound } from './rebound.ts'
import { keyedDefensePenalty } from './scoreEffects.ts'
import type { GameState, TeamState } from './state.ts'
import { contestSituationalEdge, personalEdge } from './situation.ts'
import { addPoints, lineOf, log, shortName } from './state.ts'
import {
  AND_ONE_MAKE_FACTOR,
  ASSIST_PASSING_WEIGHT,
  BASE_ASSIST,
  BASE_BLOCK_SHARE_OF_MISSES,
  BASE_MAKE,
  BASE_SHOOTING_FOUL,
  FOUL_EDGE_WEIGHT,
  HEIGHT_EDGE_WEIGHT,
  HOME_SHOOTING_EDGE,
  SHORTHANDED_SHOT_EDGE,
} from './tuning.ts'
import type { PlayType } from './types.ts'

/** Everyone involved in one shot attempt. */
export interface ShotContext {
  game: GameState
  offense: TeamState
  defense: TeamState
  shooter: Player
  /** The on-ball defender and the help rim protector contesting the shot. */
  contesters: Contesters
  playType: PlayType
  /** The teammate who passed the shooter the ball on this action, if anyone did. */
  passer?: Player
  /** Set when the shot comes on a fast break. */
  fastBreak?: FastBreak
  /**
   * Log-odds penalty from the clock: a shot rushed by the end of the period (a heave at the
   * buzzer) and/or a late-shot-clock shot by a team running clock.
   */
  rushPenalty?: number
}

/** The offense's situational edge: shooter's form, composure and the crowd, plus home court. */
function offenseSituationalEdge(ctx: ShotContext): number {
  const edge = personalEdge(ctx.game, ctx.offense, ctx.shooter, 'offense')
  return ctx.offense.isHome ? edge + HOME_SHOOTING_EDGE : edge
}

/** Log-odds edge from size near the basket: a taller finisher shoots over the contest. */
function sizeEdge(ctx: ShotContext): number {
  // Size only matters near the basket; jump shots are released too high for height to decide.
  if (!isInsideShot(ctx.playType)) return 0
  const diff = heightEdge(ctx.shooter) - contestHeight(ctx.contesters, ctx.playType)
  return HEIGHT_EDGE_WEIGHT * diff
}

/** Log-odds edge from having more players on the floor than the defense (short-handed teams). */
function numbersEdge(ctx: ShotContext): number {
  return SHORTHANDED_SHOT_EDGE * (ctx.offense.onCourt.length - ctx.defense.onCourt.length)
}

/** The chance this shot goes in (before any foul penalty). */
export function makeChance(ctx: ShotContext): number {
  const edge =
    matchupEdge(
      offensiveSkill(ctx.shooter, ctx.playType),
      contestSkill(ctx.contesters, ctx.playType),
    ) +
    offenseSituationalEdge(ctx) -
    contestSituationalEdge(ctx.game, ctx.defense, ctx.contesters, ctx.playType) +
    sizeEdge(ctx) +
    numbersEdge(ctx) +
    transitionShotEdge(ctx.fastBreak) -
    keyedDefensePenalty(ctx.game) -
    (ctx.rushPenalty ?? 0)
  return adjustProbability(BASE_MAKE[ctx.playType], edge)
}

/**
 * The chance the shooter is fouled: aggressive shooters draw fouls, disciplined defenders avoid
 * them. The help defender's Discipline counts by his share of the contest, matching who gets
 * charged with the foul.
 */
export function shootingFoulChance(ctx: ShotContext): number {
  // Equal weights on both sides, like every other matchup, so a uniformly better league
  // doesn't draw more (or fewer) fouls.
  const discipline = blendByHelp(
    ctx.playType,
    ctx.contesters.defender.attributes.discipline,
    ctx.contesters.rimProtector.attributes.discipline,
    ctx.contesters.helpFactor,
  )
  const edge =
    FOUL_EDGE_WEIGHT * normalizeRating(ctx.shooter.attributes.aggression) -
    FOUL_EDGE_WEIGHT * normalizeRating(discipline) +
    transitionFoulEdge(ctx.fastBreak) +
    contestCaution(ctx)
  return adjustProbability(BASE_SHOOTING_FOUL[ctx.playType], edge)
}

/**
 * Foul-trouble caution of the contest (zero or negative log-odds): a contester one foul from
 * disqualification counts in proportion to his share of the contest, like his Discipline.
 */
function contestCaution(ctx: ShotContext): number {
  const { game, defense, contesters } = ctx
  return blendByHelp(
    ctx.playType,
    foulCautionEdge(game, defense, contesters.defender),
    foulCautionEdge(game, defense, contesters.rimProtector),
    contesters.helpFactor,
  )
}

/** Chance a made shot off a pass counts as an assist: better passers set up better shots. */
export function assistChance(passer: Player, playType: PlayType): number {
  return adjustProbability(
    BASE_ASSIST[playType],
    ASSIST_PASSING_WEIGHT * normalizeRating(passer.attributes.passing),
  )
}

/**
 * Credits an assist on a made shot to the player who actually passed the ball, if the pass led
 * directly to the basket. A shooter who created his own shot (no pass this action) is never
 * assisted, and not every pass is an assist (e.g. a post entry the big then works for).
 */
function maybeCreditAssist(ctx: ShotContext): string {
  const passer = ctx.passer
  if (!passer || !ctx.game.rng.chance(assistChance(passer, ctx.playType))) return ''
  lineOf(ctx.offense, passer).assists += 1
  return ` (assist ${shortName(passer)})`
}

/** Decides whether a missed shot was blocked, and by whom. Returns the blocker, or undefined. */
function maybeBlock(ctx: ShotContext): Player | undefined {
  // Inside shots are usually blocked by the rim protector; jumpers only by the man guarding the
  // shooter. On a fast break where the offense outnumbers the defense nobody is back to help, so
  // only the on-ball defender can block (otherwise the rim protector still blocks inside shots).
  const help = isInsideShot(ctx.playType) && ctx.contesters.helpFactor !== 0
  const blocker = help ? ctx.contesters.rimProtector : ctx.contesters.defender
  const edge = normalizeRating(blockSkill(blocker)) + HEIGHT_EDGE_WEIGHT * heightEdge(blocker)
  const chance = adjustProbability(BASE_BLOCK_SHARE_OF_MISSES[ctx.playType], edge)
  return ctx.game.rng.chance(chance) ? blocker : undefined
}

/** Records a made or missed field goal in the shooter's box score line. */
function recordFieldGoal(ctx: ShotContext, made: boolean): void {
  const line = lineOf(ctx.offense, ctx.shooter)
  const isThree = ctx.playType === 'three'
  const tally = ctx.offense.shotsByPlayType[ctx.playType]
  line.fieldGoalsAttempted += 1
  tally.attempted += 1
  if (isThree) line.threesAttempted += 1
  if (made) {
    line.fieldGoalsMade += 1
    tally.made += 1
    if (isThree) line.threesMade += 1
  }
}

/** Play-by-play wording for this shot, with a fast-break tag. */
function shotText(ctx: ShotContext): string {
  return `${describeShot(ctx.playType)}${ctx.fastBreak ? ' on the fast break' : ''}`
}

/** Handles a made shot: points, assist, play-by-play. */
function handleMake(ctx: ShotContext, points: number): void {
  recordFieldGoal(ctx, true)
  addPoints(ctx.game, ctx.offense, ctx.shooter, points)
  const assist = maybeCreditAssist(ctx)
  log(ctx.game, ctx.offense, `${shortName(ctx.shooter)} makes ${shotText(ctx)}${assist}`)
}

/** Handles a missed shot that wasn't fouled: box score, possible block, play-by-play. Returns the blocker. */
function handleMiss(ctx: ShotContext): Player | undefined {
  recordFieldGoal(ctx, false)
  log(ctx.game, ctx.offense, `${shortName(ctx.shooter)} misses ${shotText(ctx)}`)
  const blocker = maybeBlock(ctx)
  if (blocker) {
    lineOf(ctx.defense, blocker).blocks += 1
    log(ctx.game, ctx.defense, `${shortName(blocker)} blocks ${shortName(ctx.shooter)}'s shot`)
  }
  return blocker
}

/** Resolves a full shot attempt, including fouls, free throws, and the rebound. */
export function resolveShot(ctx: ShotContext): ActionOutcome {
  const points = ctx.playType === 'three' ? 3 : 2
  const fouled = ctx.game.rng.chance(shootingFoulChance(ctx))
  const made = ctx.game.rng.chance(makeChance(ctx) * (fouled ? AND_ONE_MAKE_FACTOR : 1))

  let blocker: Player | undefined
  if (made) handleMake(ctx, points)
  // Basketball scoring rule: a missed shot on a shooting foul is not counted as a field goal attempt.
  else if (!fouled) blocker = handleMiss(ctx)

  if (fouled) {
    // The foul goes to whichever contester was responsible, in proportion to their share of the
    // contest: on drives and cuts the help rim protector picks up about half of them.
    const fouler = pickContester(ctx.game.rng, ctx.contesters, ctx.playType)
    commitFoul(ctx.game, ctx.defense, fouler, 'Shooting foul')
    // And-one: 1 free throw after a make; otherwise as many free throws as the shot was worth.
    const freeThrows = made ? 1 : points
    return shootFreeThrows(ctx.game, ctx.offense, ctx.defense, ctx.shooter, freeThrows)
  }
  if (made) return possessionOver()
  return resolveRebound(ctx.game, ctx.offense, ctx.defense, blocker ? 'block' : 'shot')
}
