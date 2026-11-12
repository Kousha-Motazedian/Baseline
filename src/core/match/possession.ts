import type { Player } from '../players/types.ts'
import type { Rng } from '../shared/rng.ts'
import type { LeagueRules } from '../world/rules.ts'
import { findContesters, pickContester } from './contest.ts'
import type { FastBreak } from './fastBreak.ts'
import { startFastBreak, transitionHelpFactor } from './fastBreak.ts'
import {
  commitFoul,
  nonShootingFoulChance,
  nonShootingFoulLabel,
  offensiveFoulChance,
} from './fouls.ts'
import { shootFreeThrows, worstFreeThrowShooter } from './freeThrows.ts'
import { pickHandler } from './handler.ts'
import type { ActionKind, ActionOutcome, NextAction } from './outcome.ts'
import { continueWith } from './outcome.ts'
import type { PlayChoice, PlayOptions } from './playSelection.ts'
import { choosePlay } from './playSelection.ts'
import { scoreAdjustedSeconds, threePointHuntFactor, wantsIntentionalFoul } from './scoreEffects.ts'
import { resolveShot } from './shot.ts'
import type { GameState, TeamState } from './state.ts'
import { matchupDefender, runClock } from './state.ts'
import {
  ACTION_TIMING,
  BASE_CHARGE,
  BASE_HANDLER_OFFENSIVE_FOUL,
  BASE_HANDLER_TURNOVER,
  BASE_NON_SHOOTING_FOUL,
  BASE_PLAY_SHARE,
  BUZZER_SHOT_PENALTY,
  INTENTIONAL_FOUL_MIN_SECONDS,
  INTENTIONAL_FOUL_SPREAD_SECONDS,
  ON_BALL_FOUL_SHARE,
  TRANSITION_PLAY_SHARE,
} from './tuning.ts'
import { offensiveFoulTurnover, tryHandlerTurnover, tryShooterTurnover } from './turnover.ts'

/**
 * One possession, as a chain of actions. Each action starts with a ball handler, who either
 * keeps it or passes to the shooter chosen for the play; things can go wrong at either stage.
 *
 *   handler phase   lost ball / bad pass, offensive foul (push-off), defensive non-shooting foul
 *   shooter phase   fumbled catch / travel / strip, charge
 *   shot            shooting foul, make or miss, block, assist to the passer, rebound
 *
 * An offensive rebound leads to a putback or a reset; a defensive foul without free throws to a
 * side-out. A possession can also start as a fast break.
 */

/** The action about to be run. */
type Action = { kind: 'halfCourt' } | { kind: 'transition'; starter: Player } | NextAction

/** How a possession starts: after a turnover, and/or as a fast break led by a given player. */
export interface PossessionStart {
  fastBreak: Player | undefined
  afterTurnover: boolean
}

/** How a possession ended, which decides how the next one starts. */
export interface PossessionEnd {
  fastBreak: Player | undefined
  turnover: boolean
}

/** A normal possession: half-court, not after a turnover. */
export const HALF_COURT_START: PossessionStart = { fastBreak: undefined, afterTurnover: false }

/** How many seconds an action takes before it ends, capped by the shot clock. */
export function actionSeconds(rng: Rng, kind: ActionKind, shotClock: number): number {
  const { min, spread } = ACTION_TIMING[kind]
  // Averaging two random rolls makes medium-length possessions most common and very quick
  // or very long ones rarer, which matches how real possessions are distributed.
  const seconds = min + ((rng.next() + rng.next()) / 2) * spread
  return Math.min(seconds, shotClock)
}

/** Seconds for this action, including late-game clock management for set plays. */
function setSeconds(
  game: GameState,
  offense: TeamState,
  kind: ActionKind,
  shotClock: number,
): number {
  const seconds = actionSeconds(game.rng, kind, shotClock)
  // Score effects change how long a set takes; putbacks and fast breaks are instinctive.
  if (kind === 'transition') return seconds
  return Math.min(scoreAdjustedSeconds(game, offense, seconds, shotClock), shotClock)
}

/** How the offense picks its play: fast-break looks, or half-court sets (with three hunting late). */
function playOptions(
  game: GameState,
  offense: TeamState,
  fastBreak: FastBreak | undefined,
): PlayOptions {
  const threeFactor = threePointHuntFactor(game, offense)
  if (!fastBreak) return { shares: BASE_PLAY_SHARE, helpFactor: 1, threeFactor }
  return { shares: TRANSITION_PLAY_SHARE, helpFactor: transitionHelpFactor(fastBreak), threeFactor }
}

/**
 * Log-odds penalty for a shot rushed by the end of the period: the share of the action the game
 * clock cut off, times the full penalty. With 2 s left for a 14 s action the shot is a heave.
 */
export function rushPenalty(gameClock: number, wantedSeconds: number): number {
  if (wantedSeconds <= 0 || gameClock >= wantedSeconds) return 0
  return BUZZER_SHOT_PENALTY * (1 - gameClock / wantedSeconds)
}

/** Everything decided at the start of a set: who has the ball, the play, and how long it takes. */
interface SetPlay {
  game: GameState
  offense: TeamState
  defense: TeamState
  handler: Player
  play: PlayChoice
  fastBreak: FastBreak | undefined
  /** Log-odds penalty if the period clock cut the action short. */
  rush: number
}

/** Handler phase, part 2: an offensive foul by the handler (push-off, moving screen in the action). */
function tryHandlerOffensiveFoul(set: SetPlay, handlerDefender: Player): ActionOutcome | undefined {
  const { game, offense, handler } = set
  const chance = offensiveFoulChance(BASE_HANDLER_OFFENSIVE_FOUL, handler, handlerDefender)
  if (!game.rng.chance(chance)) return undefined
  const outcome = offensiveFoulTurnover(game, offense, handler)
  commitFoul(game, offense, handler, 'Offensive foul')
  return outcome
}

/**
 * Handler phase, part 3: a defensive non-shooting foul. Usually on the ball (reach-in, blocking
 * on the handler); otherwise off the ball on the intended receiver (holding). In the bonus the
 * fouled player shoots free throws; otherwise the offense inbounds and runs another set.
 */
function tryNonShootingFoul(set: SetPlay, handlerDefender: Player): ActionOutcome | undefined {
  const { game, offense, defense, handler, play } = set
  const onBall = play.player === handler || game.rng.chance(ON_BALL_FOUL_SHARE)
  const victim = onBall ? handler : play.player
  const fouler = onBall ? handlerDefender : play.contesters.defender
  if (!game.rng.chance(nonShootingFoulChance(BASE_NON_SHOOTING_FOUL, victim, fouler)))
    return undefined
  const penalty = commitFoul(game, defense, fouler, nonShootingFoulLabel(game, onBall))
  if (!penalty) return continueWith({ kind: 'sideOut' })
  return shootFreeThrows(game, offense, defense, victim, game.rules.penaltyFreeThrows)
}

/** Shooter phase, part 2: a charge (or other offensive foul on his own move) by the shooter. */
function tryCharge(set: SetPlay): ActionOutcome | undefined {
  const { game, offense, play } = set
  // The help defender draws charges too, in proportion to his share of the contest.
  const drawer = pickContester(game.rng, play.contesters, play.playType)
  const chance = offensiveFoulChance(BASE_CHARGE[play.playType], play.player, drawer)
  if (!game.rng.chance(chance)) return undefined
  const outcome = offensiveFoulTurnover(game, offense, play.player)
  commitFoul(game, offense, play.player, 'Offensive foul (charge)')
  return outcome
}

/** Runs the handler phase, the shooter phase and the shot, stopping at the first thing that ends the action. */
function playOutSet(set: SetPlay): ActionOutcome {
  const { game, offense, defense, handler, play } = set
  const handlerDefender = matchupDefender(offense, defense, handler)
  const received = play.player !== handler
  const handlerTurnover = tryHandlerTurnover({
    game,
    offense,
    defense,
    handler,
    handlerDefender,
    receiver: play.player,
    receiverDefender: play.contesters.defender,
    base: BASE_HANDLER_TURNOVER,
  })
  if (handlerTurnover) return handlerTurnover
  const early =
    tryHandlerOffensiveFoul(set, handlerDefender) ?? tryNonShootingFoul(set, handlerDefender)
  if (early) return early

  const shooterTurnover = tryShooterTurnover(
    game,
    offense,
    defense,
    play.player,
    play.contesters.defender,
    play.playType,
    received,
  )
  if (shooterTurnover) return shooterTurnover
  const charge = tryCharge(set)
  if (charge) return charge

  return resolveShot({
    game,
    offense,
    defense,
    shooter: play.player,
    contesters: play.contesters,
    playType: play.playType,
    passer: received ? handler : undefined,
    fastBreak: set.fastBreak,
    rushPenalty: set.rush,
  })
}

/** A set play (half-court, reset, side-out or fast break): handler, play, clock, then the play itself. */
function runSet(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  action: Action,
  shotClock: number,
): ActionOutcome {
  const fastBreak =
    action.kind === 'transition' ? startFastBreak(game, offense, defense) : undefined
  // On a fast break the player who won the ball pushes it himself.
  const starter = action.kind === 'transition' ? action.starter : undefined
  const handler =
    starter && offense.onCourt.includes(starter) ? starter : pickHandler(game.rng, offense.onCourt)
  const play = choosePlay(game.rng, offense, defense, playOptions(game, offense, fastBreak))
  const seconds = setSeconds(game, offense, action.kind, shotClock)
  const rush = rushPenalty(game.clock, seconds)
  runClock(game, seconds)
  return playOutSet({ game, offense, defense, handler, play, fastBreak, rush })
}

/** A putback: the offensive rebounder goes straight back up, usually unassisted and with little time used. */
function runPutback(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  rebounder: Player,
  shotClock: number,
): ActionOutcome {
  const seconds = actionSeconds(game.rng, 'putback', shotClock)
  const rush = rushPenalty(game.clock, seconds)
  runClock(game, seconds)
  const contesters = findContesters(offense, defense, rebounder)
  const turnover = tryShooterTurnover(
    game,
    offense,
    defense,
    rebounder,
    contesters.defender,
    'putback',
    false,
  )
  if (turnover) return turnover
  return resolveShot({
    game,
    offense,
    defense,
    shooter: rebounder,
    contesters,
    playType: 'putback',
    rushPenalty: rush,
  })
}

/**
 * The trailing defense fouls on purpose: quickly, on the offense's worst free-throw shooter.
 * It counts toward team fouls like any other; free throws only once they're in the bonus.
 */
function intentionalFoul(game: GameState, offense: TeamState, defense: TeamState): ActionOutcome {
  runClock(game, INTENTIONAL_FOUL_MIN_SECONDS + game.rng.next() * INTENTIONAL_FOUL_SPREAD_SECONDS)
  const target = worstFreeThrowShooter(offense.onCourt)
  const fouler = matchupDefender(offense, defense, target)
  const penalty = commitFoul(game, defense, fouler, 'Intentional foul')
  if (!penalty) return continueWith({ kind: 'sideOut' })
  return shootFreeThrows(game, offense, defense, target, game.rules.penaltyFreeThrows)
}

/** Runs one action of whatever kind and returns how it ended. */
function runAction(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  action: Action,
  shotClock: number,
): ActionOutcome {
  if (wantsIntentionalFoul(game, defense)) return intentionalFoul(game, offense, defense)
  if (action.kind === 'putback') {
    return runPutback(game, offense, defense, action.rebounder, shotClock)
  }
  return runSet(game, offense, defense, action, shotClock)
}

/** The shot clock for the next action: reset after an offensive rebound, topped up after a foul. */
function nextShotClock(rules: LeagueRules, next: NextAction, remaining: number): number {
  if (next.kind === 'sideOut') return Math.max(remaining, rules.foulResetShotClockSeconds)
  return rules.offensiveReboundShotClockSeconds
}

/** The first action of a possession: a fast break if one was started (and the starter is still on). */
function firstAction(offense: TeamState, start: PossessionStart): Action {
  const starter = start.fastBreak
  return starter && offense.onCourt.includes(starter)
    ? { kind: 'transition', starter }
    : { kind: 'halfCourt' }
}

/** Simulates one full possession, including any second chances, and says how it ended. */
export function simulatePossession(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  start: PossessionStart = HALF_COURT_START,
): PossessionEnd {
  offense.possessions += 1
  const pointsAtStart = offense.points
  let action = firstAction(offense, start)
  let shotClock = game.rules.shotClockSeconds
  let end: PossessionEnd = { fastBreak: undefined, turnover: false }
  // The possession ends on a score, turnover, defensive rebound, or when the period clock runs out.
  while (game.clock > 0) {
    const clockBefore = game.clock
    const pointsBefore = offense.points
    const outcome = runAction(game, offense, defense, action, shotClock)
    // Fast-break points: everything the transition action itself produced, free throws included.
    if (action.kind === 'transition') offense.fastBreakPoints += offense.points - pointsBefore
    if (outcome.over) {
      end = { fastBreak: outcome.fastBreak, turnover: outcome.turnover }
      break
    }
    shotClock = nextShotClock(game.rules, outcome.next, shotClock - (clockBefore - game.clock))
    action = outcome.next
  }
  if (start.afterTurnover) offense.pointsOffTurnovers += offense.points - pointsAtStart
  return end
}
