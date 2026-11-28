import type { Player } from '../players/types.ts'
import type { Rng } from '../shared/rng.ts'
import type { LeagueRules } from '../world/rules.ts'
import { lastShotTimingError, twoForOneChance } from './endGame.ts'
import { findContesters, pickContester } from './contest.ts'
import type { FastBreak } from './fastBreak.ts'
import { startFastBreak, transitionHelpFactor } from './fastBreak.ts'
import {
  commitFoul,
  foulCautionEdge,
  intentionalFouler,
  nonShootingFoulChance,
  nonShootingFoulLabel,
  offensiveFoulChance,
} from './fouls.ts'
import { shootFreeThrows, worstFreeThrowShooter } from './freeThrows.ts'
import { pickHandler } from './handler.ts'
import type { ActionKind, ActionOutcome, NextAction } from './outcome.ts'
import { continueWith, possessionOver } from './outcome.ts'
import type { PlayChoice, PlayOptions } from './playSelection.ts'
import { choosePlay } from './playSelection.ts'
import type { IntentionalFoulPlan } from './scoreEffects.ts'
import {
  awayFromPlayRuleApplies,
  canRunOutClock,
  endOfPeriodSeconds,
  intentionalFoulPlan,
  intentionalFoulSeconds,
  milkShotPenalty,
  scoreAdjustedSeconds,
  threePointHuntFactor,
} from './scoreEffects.ts'
import { resolveShot } from './shot.ts'
import type { GameState, TeamState } from './state.ts'
import { isLateInGame, leadOf, log, matchupDefender, runClock } from './state.ts'
import { takeSavedSeconds } from './timeouts.ts'
import {
  ACTION_TIMING,
  BASE_CHARGE,
  BASE_HANDLER_OFFENSIVE_FOUL,
  BASE_HANDLER_TURNOVER,
  BASE_NON_SHOOTING_FOUL,
  BUZZER_SHOT_PENALTY,
  ON_BALL_FOUL_SHARE,
  TRANSITION_PLAY_SHARE,
  TWO_FOR_ONE_LEAVE_SECONDS,
  TWO_FOR_ONE_MAX_SECONDS,
  TWO_FOR_ONE_MIN_SECONDS,
  USAGE_EXPONENT,
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
type Action =
  { kind: 'halfCourt'; quick?: boolean } | { kind: 'transition'; starter: Player } | NextAction

/** How a possession starts: after a turnover, and/or as a fast break led by a given player. */
export interface PossessionStart {
  fastBreak: Player | undefined
  afterTurnover: boolean
}

/** How a possession ended, which decides how the next one starts. */
export interface PossessionEnd {
  fastBreak: Player | undefined
  turnover: boolean
  /** True if the last action scored (a made shot or free throws): the next dead ball follows a score. */
  scored: boolean
}

/** Actions in a row that may use no clock before a possession is declared stuck. */
const MAX_STALLED_ACTIONS = 50

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

/**
 * A set's rolled length after the offense's pace (fast teams run shorter half-court sets, slow
 * ones longer). Fast breaks and putbacks keep their natural length: pace is about how long the
 * offense works for a shot in the half court. Neutral pace returns the roll untouched.
 */
export function pacedSeconds(
  offense: TeamState,
  kind: ActionKind,
  rolled: number,
  shotClock: number,
): number {
  const factor = offense.tactics.effects.setSecondsFactor
  if (factor === 1 || kind === 'transition' || kind === 'putback') return rolled
  return Math.min(rolled * factor, shotClock)
}

/** How long a set takes, and the log-odds clock penalty on its shot (buzzer rush, milking). */
interface SetTiming {
  seconds: number
  rush: number
}

/**
 * Timing for a set, including late-game clock management. Fast breaks are instinctive: they keep
 * their natural length (and can be rushed by the buzzer). Other sets stretch or shrink with the
 * score, and near the end of a period they're timed to get the shot off before the buzzer.
 */
function setTiming(
  game: GameState,
  offense: TeamState,
  kind: ActionKind,
  shotClock: number,
  quickShot = false,
): SetTiming {
  const natural = pacedSeconds(offense, kind, actionSeconds(game.rng, kind, shotClock), shotClock)
  // A timeout in the last 2:00 saves the clock spent bringing the ball up (first set only).
  const min = ACTION_TIMING[kind].min
  const saved = Math.max(min, natural - takeSavedSeconds(offense))
  // A 2-for-1 shot goes up early enough that the clock still allows another possession after it.
  const rolled = quickShot
    ? Math.max(min, Math.min(saved, game.clock - TWO_FOR_ONE_LEAVE_SECONDS))
    : saved
  if (kind === 'transition') return { seconds: rolled, rush: rushPenalty(game.clock, rolled) }
  const adjusted = Math.min(scoreAdjustedSeconds(game, offense, rolled, shotClock), shotClock)
  // The coach's feel for the clock: a poor one shoots the last shot too early or too late.
  const error = game.clock <= shotClock ? lastShotTimingError(game.rng, offense.coach) : 0
  const timed = endOfPeriodSeconds(game, offense, adjusted, shotClock, min, error)
  const seconds = timed ?? adjusted
  // A milked possession's late-clock shot is worse, like a shot rushed by the buzzer.
  return { seconds, rush: rushPenalty(game.clock, seconds) + milkShotPenalty(game, offense) }
}

/**
 * How the offense picks its play: fast-break looks, or half-court sets (with three hunting late).
 * The system shapes the half-court mix (shot profile, primary action) and how much the best
 * players dominate the shots (ball movement); fast-break looks are instinctive and keep their mix.
 */
function playOptions(
  game: GameState,
  offense: TeamState,
  fastBreak: FastBreak | undefined,
): PlayOptions {
  const threeFactor = threePointHuntFactor(game, offense)
  const usageExponent = USAGE_EXPONENT * offense.tactics.effects.usageExponentFactor
  if (!fastBreak) {
    return { shares: offense.tactics.halfCourtShares, helpFactor: 1, threeFactor, usageExponent }
  }
  return {
    shares: TRANSITION_PLAY_SHARE,
    helpFactor: transitionHelpFactor(fastBreak),
    threeFactor,
    usageExponent,
  }
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
  /** Log-odds clock penalty on the shot: cut short by the buzzer, or late in a milked shot clock. */
  rush: number
}

/** Handler phase, part 2: an offensive foul by the handler (push-off, moving screen in the action). */
function tryHandlerOffensiveFoul(set: SetPlay, handlerDefender: Player): ActionOutcome | undefined {
  const { game, offense, handler } = set
  const caution = foulCautionEdge(game, offense, handler)
  const chance = offensiveFoulChance(BASE_HANDLER_OFFENSIVE_FOUL, handler, handlerDefender, caution)
  if (!game.rng.chance(chance)) return undefined
  const outcome = offensiveFoulTurnover(game, offense, handler)
  commitFoul(game, offense, handler, 'Offensive foul', 'offensive')
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
  // The defense's pressure setting (aggressive defenses reach more) rides on the caution edge.
  const caution =
    foulCautionEdge(game, defense, fouler) + defense.tactics.effects.nonShootingFoulEdge
  if (!game.rng.chance(nonShootingFoulChance(BASE_NON_SHOOTING_FOUL, victim, fouler, caution)))
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
  const caution = foulCautionEdge(game, offense, play.player)
  const chance = offensiveFoulChance(BASE_CHARGE[play.playType], play.player, drawer, caution)
  if (!game.rng.chance(chance)) return undefined
  const outcome = offensiveFoulTurnover(game, offense, play.player)
  commitFoul(game, offense, play.player, 'Offensive foul (charge)', 'offensive')
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
  const quick = action.kind === 'halfCourt' && action.quick === true
  const { seconds, rush } = setTiming(game, offense, action.kind, shotClock, quick)
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
 * Who the defense fouls on purpose. Denying the tying three, it fouls whoever has the ball before
 * he can shoot. Stopping the clock, it would rather send the offense's worst free-throw shooter
 * to the line, but where the away-from-the-play rule applies (pro, last 2:00) fouling anyone but
 * the ball handler costs a free throw plus possession, so it fouls the ball handler (or the
 * inbound receiver: the same pick). FIBA has no such rule; its unsportsmanlike-foul rule (an
 * obvious foul with no play on the ball: 2 free throws plus possession) isn't modelled.
 */
function intentionalFoulTarget(
  game: GameState,
  offense: TeamState,
  plan: IntentionalFoulPlan,
): Player {
  if (plan === 'denyThree' || awayFromPlayRuleApplies(game)) {
    return pickHandler(game.rng, offense.onCourt)
  }
  return worstFreeThrowShooter(offense.onCourt)
}

/**
 * The defense fouls on purpose, quickly (see IntentionalFoulPlan for why). It counts toward team
 * fouls like any other; free throws only once they're in the bonus, otherwise a side-out.
 */
function intentionalFoul(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  plan: IntentionalFoulPlan,
): ActionOutcome {
  runClock(game, intentionalFoulSeconds(game))
  const target = intentionalFoulTarget(game, offense, plan)
  const fouler = intentionalFouler(game, offense, defense, target)
  const penalty = commitFoul(game, defense, fouler, 'Intentional foul', 'intentional')
  if (!penalty) return continueWith({ kind: 'sideOut' })
  return shootFreeThrows(game, offense, defense, target, game.rules.penaltyFreeThrows)
}

/**
 * A leading team that can run out the clock just holds the ball: no shot, no rushed heave; the
 * period ends with the possession.
 */
function runOutClock(game: GameState, offense: TeamState): ActionOutcome {
  runClock(game, game.clock)
  log(game, offense, `${offense.team.name} run out the clock`)
  return possessionOver()
}

/** Runs one action of whatever kind and returns how it ended. */
function runAction(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  action: Action,
  shotClock: number,
): ActionOutcome {
  // The defense moves first: a trailing team fouls before the leader can run out the clock.
  const foulPlan = intentionalFoulPlan(game, defense, shotClock)
  if (foulPlan) return intentionalFoul(game, offense, defense, foulPlan)
  if (canRunOutClock(game, offense, shotClock)) return runOutClock(game, offense)
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
function firstAction(game: GameState, offense: TeamState, start: PossessionStart): Action {
  const starter = start.fastBreak
  if (starter && offense.onCourt.includes(starter)) return { kind: 'transition', starter }
  return { kind: 'halfCourt', quick: goesForTwoForOne(game, offense) }
}

/**
 * True if the offense takes a quick shot to get the period's last possession too (a 2-for-1): the
 * clock is in the 2-for-1 window, a team protecting a late lead never does, and the coach has to
 * see it (Game Management). Counted for the batch report when it does.
 */
function goesForTwoForOne(game: GameState, offense: TeamState): boolean {
  if (game.clock > TWO_FOR_ONE_MAX_SECONDS || game.clock < TWO_FOR_ONE_MIN_SECONDS) return false
  if (isLateInGame(game, TWO_FOR_ONE_MAX_SECONDS) && leadOf(game, offense) > 0) return false
  if (!game.rng.chance(twoForOneChance(offense.coach))) return false
  offense.twoForOnes += 1
  return true
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
  let action = firstAction(game, offense, start)
  let shotClock = game.rules.shotClockSeconds
  let end: PossessionEnd = { fastBreak: undefined, turnover: false, scored: false }
  // The possession ends on a score, turnover, defensive rebound, or when the period clock runs out.
  let stalledActions = 0
  while (game.clock > 0) {
    const clockBefore = game.clock
    const pointsBefore = offense.points
    const outcome = runAction(game, offense, defense, action, shotClock)
    // Fast-break points: everything the transition action itself produced, free throws included.
    if (action.kind === 'transition') offense.fastBreakPoints += offense.points - pointsBefore
    if (outcome.over) {
      end = {
        fastBreak: outcome.fastBreak,
        turnover: outcome.turnover,
        scored: offense.points > pointsBefore,
      }
      break
    }
    // Defensive guard: actions that use no clock would loop forever.
    stalledActions = game.clock < clockBefore ? 0 : stalledActions + 1
    if (stalledActions > MAX_STALLED_ACTIONS) {
      throw new Error(`Possession stalled: ${action.kind} used no clock (${game.clock} s left)`)
    }
    shotClock = nextShotClock(game.rules, outcome.next, shotClock - (clockBefore - game.clock))
    action = outcome.next
  }
  if (start.afterTurnover) offense.pointsOffTurnovers += offense.points - pointsAtStart
  return end
}
