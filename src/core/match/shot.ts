import type { Player } from '../players/types.ts'
import { adjustProbability, normalizeRating } from '../shared/probability.ts'
import { pickWeighted } from '../shared/weighted.ts'
import { describeShot } from './describe.ts'
import { recordFoul } from './fouls.ts'
import { shootFreeThrows } from './freeThrows.ts'
import type { Contesters } from './contest.ts'
import { contestHeight, contestSkill, isInsideShot, matchupEdge } from './contest.ts'
import { blockSkill, heightEdge, offensiveSkill } from './ratings.ts'
import type { ActionOutcome } from './rebound.ts'
import { resolveRebound } from './rebound.ts'
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
}

/** The offense's situational edge: shooter's form and clutch composure, plus home court. */
function offenseSituationalEdge(ctx: ShotContext): number {
  const edge = personalEdge(ctx.game, ctx.offense, ctx.shooter)
  return ctx.offense.isHome ? edge + HOME_SHOOTING_EDGE : edge
}

/** Log-odds edge from size near the basket: a taller finisher shoots over the contest. */
function sizeEdge(ctx: ShotContext): number {
  // Size only matters near the basket; jump shots are released too high for height to decide.
  if (!isInsideShot(ctx.playType)) return 0
  const diff = heightEdge(ctx.shooter) - contestHeight(ctx.contesters, ctx.playType)
  return HEIGHT_EDGE_WEIGHT * diff
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
    sizeEdge(ctx)
  return adjustProbability(BASE_MAKE[ctx.playType], edge)
}

/** The chance the shooter is fouled: aggressive shooters draw fouls, disciplined defenders avoid them. */
export function shootingFoulChance(ctx: ShotContext): number {
  // Equal weights on both sides, like every other matchup, so a uniformly better league
  // doesn't draw more (or fewer) fouls.
  const edge =
    FOUL_EDGE_WEIGHT * normalizeRating(ctx.shooter.attributes.aggression) -
    FOUL_EDGE_WEIGHT * normalizeRating(ctx.contesters.defender.attributes.discipline)
  return adjustProbability(BASE_SHOOTING_FOUL[ctx.playType], edge)
}

/** Credits an assist on a made shot, if one happened. Good passers on the floor create more assisted baskets. */
function maybeCreditAssist(ctx: ShotContext): string {
  const teammates = ctx.offense.onCourt.filter((p) => p !== ctx.shooter)
  const avgPassing = teammates.reduce((s, p) => s + p.attributes.passing, 0) / teammates.length
  const chance = adjustProbability(
    BASE_ASSIST[ctx.playType],
    ASSIST_PASSING_WEIGHT * normalizeRating(avgPassing),
  )
  if (!ctx.game.rng.chance(chance)) return ''

  const passer = pickWeighted(ctx.game.rng, teammates, (p) => p.attributes.passing ** 2)
  lineOf(ctx.offense, passer).assists += 1
  return ` (assist ${shortName(passer)})`
}

/** Decides whether a missed shot was blocked, and by whom. Returns the blocker, or undefined. */
function maybeBlock(ctx: ShotContext): Player | undefined {
  // Inside shots are usually blocked by the rim protector; jumpers only by the man guarding the shooter.
  const blocker = isInsideShot(ctx.playType) ? ctx.contesters.rimProtector : ctx.contesters.defender
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

/** Handles a made shot: points, assist, play-by-play. */
function handleMake(ctx: ShotContext, points: number): void {
  recordFieldGoal(ctx, true)
  addPoints(ctx.game, ctx.offense, ctx.shooter, points)
  const assist = maybeCreditAssist(ctx)
  log(
    ctx.game,
    ctx.offense,
    `${shortName(ctx.shooter)} makes ${describeShot(ctx.playType)}${assist}`,
  )
}

/** Handles a missed shot that wasn't fouled: box score, possible block, play-by-play. */
function handleMiss(ctx: ShotContext): void {
  recordFieldGoal(ctx, false)
  const blocker = maybeBlock(ctx)
  if (blocker) {
    lineOf(ctx.defense, blocker).blocks += 1
    log(
      ctx.game,
      ctx.offense,
      `${shortName(blocker)} blocks ${shortName(ctx.shooter)}'s ${describeShot(ctx.playType)}`,
    )
  } else {
    log(ctx.game, ctx.offense, `${shortName(ctx.shooter)} misses ${describeShot(ctx.playType)}`)
  }
}

/** Resolves a full shot attempt, including fouls, free throws, and the rebound. */
export function resolveShot(ctx: ShotContext): ActionOutcome {
  const points = ctx.playType === 'three' ? 3 : 2
  const fouled = ctx.game.rng.chance(shootingFoulChance(ctx))
  const made = ctx.game.rng.chance(makeChance(ctx) * (fouled ? AND_ONE_MAKE_FACTOR : 1))

  if (made) handleMake(ctx, points)
  // Basketball scoring rule: a missed shot on a shooting foul is not counted as a field goal attempt.
  else if (!fouled) handleMiss(ctx)

  if (fouled) {
    recordFoul(ctx.game, ctx.defense, ctx.contesters.defender)
    // And-one: 1 free throw after a make; otherwise as many free throws as the shot was worth.
    const freeThrows = made ? 1 : points
    return shootFreeThrows(ctx.game, ctx.offense, ctx.defense, ctx.shooter, freeThrows)
  }
  return made ? 'possessionOver' : resolveRebound(ctx.game, ctx.offense, ctx.defense, false)
}
