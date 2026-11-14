import type { Player } from '../players/types.ts'
import { adjustProbability, normalizeRating } from '../shared/probability.ts'
import { matchupEdge } from './contest.ts'
import { maybeFastBreak } from './fastBreak.ts'
import type { ActionOutcome } from './outcome.ts'
import { ballPressureSkill, ballSecuritySkill, passSecuritySkill } from './ratings.ts'
import { personalEdge } from './situation.ts'
import type { GameState, TeamState } from './state.ts'
import { lineOf, log, shortName } from './state.ts'
import {
  BASE_HANDLER_TURNOVER,
  BASE_SHOOTER_TURNOVER,
  HANDLER_STEAL_SHARE,
  PASSING_LANE_STEAL_SHARE,
  SHOOTER_STEAL_SHARE,
  STEAL_FAST_BREAK,
} from './tuning.ts'
import type { PlayType } from './types.ts'

/**
 * Turnovers, charged to whoever last touched the ball. An action can go wrong in two places:
 * - handler phase: the ball handler loses it dribbling or throws a bad pass (handler's turnover);
 * - shooter phase: the player who received it fumbles the catch, travels or is stripped on his
 *   move (shooter's turnover). When the handler keeps it himself, both phases are his.
 * Steals go to the defender guarding the player who lost it, or on a bad pass sometimes to the
 * defender in the passing lane (the one guarding the intended receiver).
 */

/** Chance of a turnover from a security rating against a pressure rating (both 1–20). */
export function turnoverChanceFromSkills(
  base: number,
  security: number,
  pressure: number,
  situationalEdge = 0,
): number {
  // Same matchup edge as shots, from the offense's point of view: a positive edge means the
  // handler is winning, which LOWERS the turnover chance, hence the minus sign.
  return adjustProbability(base, -matchupEdge(security, pressure) - situationalEdge)
}

/**
 * Chance a player turns it over against this defender on dribble security alone (the handler
 * phase when he keeps the ball; when he passes, tryHandlerTurnover also blends in Pass Security).
 */
export function turnoverChance(
  handler: Player,
  defender: Player,
  situationalEdge = 0,
  base = BASE_HANDLER_TURNOVER,
): number {
  return turnoverChanceFromSkills(
    base,
    ballSecuritySkill(handler),
    ballPressureSkill(defender),
    situationalEdge,
  )
}

/** Chance a turnover is a steal by `defender`, from a base share for this kind of turnover. */
export function stealChance(defender: Player, baseShare = HANDLER_STEAL_SHARE): number {
  return adjustProbability(baseShare, normalizeRating(defender.attributes.stealing))
}

/** Form, composure and crowd for both players: a hot defender forces more mistakes. */
function situational(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  player: Player,
  defender: Player,
): number {
  return (
    personalEdge(game, offense, player, 'offense') -
    personalEdge(game, defense, defender, 'defense')
  )
}

/** Records a turnover (and a steal, if any) and returns the end of the possession. */
function recordTurnover(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  loser: Player,
  description: string,
  stealer: Player | undefined,
): ActionOutcome {
  lineOf(offense, loser).turnovers += 1
  log(game, offense, `${shortName(loser)} turnover (${description})`)
  if (!stealer) return { over: true, turnover: true, fastBreak: undefined }
  lineOf(defense, stealer).steals += 1
  log(game, defense, `${shortName(stealer)} steal`)
  // A steal catches the offense moving the wrong way: the most common start of a fast break.
  const fastBreak = maybeFastBreak(game, defense, offense, stealer, STEAL_FAST_BREAK)
  return { over: true, turnover: true, fastBreak }
}

/** Everyone involved in the handler phase of an action. */
export interface HandlerPhase {
  game: GameState
  offense: TeamState
  defense: TeamState
  handler: Player
  handlerDefender: Player
  /** The player the handler is getting the ball to (the handler himself if he keeps it). */
  receiver: Player
  receiverDefender: Player
  /** Base chance of a handler-phase turnover (BASE_HANDLER_TURNOVER on every set today). */
  base: number
}

/** The handler's security on this action: passing skill matters too when he gives it up. */
function handlerSecurity(phase: HandlerPhase): number {
  const dribble = ballSecuritySkill(phase.handler)
  if (phase.receiver === phase.handler) return dribble
  return (dribble + passSecuritySkill(phase.handler)) / 2
}

/** Who steals a handler-phase turnover, if anyone: on-ball defender or passing-lane defender. */
function handlerStealer(phase: HandlerPhase, passing: boolean): Player | undefined {
  const lane = passing && phase.game.rng.chance(PASSING_LANE_STEAL_SHARE)
  const candidate = lane ? phase.receiverDefender : phase.handlerDefender
  return phase.game.rng.chance(stealChance(candidate, HANDLER_STEAL_SHARE)) ? candidate : undefined
}

/** Rolls for a handler-phase turnover (lost ball or bad pass). Returns the outcome, or undefined. */
export function tryHandlerTurnover(phase: HandlerPhase): ActionOutcome | undefined {
  const { game, offense, defense, handler, handlerDefender } = phase
  const edge = situational(game, offense, defense, handler, handlerDefender)
  const chance = turnoverChanceFromSkills(
    phase.base,
    handlerSecurity(phase),
    ballPressureSkill(handlerDefender),
    edge,
  )
  if (!game.rng.chance(chance)) return undefined
  const passing = phase.receiver !== handler
  const stealer = handlerStealer(phase, passing)
  return recordTurnover(
    game,
    offense,
    defense,
    handler,
    passing ? 'bad pass' : 'lost ball',
    stealer,
  )
}

/** Play-by-play wording for a turnover on the shooter's own move. */
function shooterTurnoverText(playType: PlayType, received: boolean): string {
  if (playType === 'drive' || playType === 'postUp') return 'stripped'
  return received ? 'fumbled catch' : 'traveling'
}

/** Rolls for a shooter-phase turnover (fumbled catch, travel, strip on his move). */
export function tryShooterTurnover(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  shooter: Player,
  defender: Player,
  playType: PlayType,
  received: boolean,
): ActionOutcome | undefined {
  const edge = situational(game, offense, defense, shooter, defender)
  const chance = turnoverChanceFromSkills(
    BASE_SHOOTER_TURNOVER[playType],
    ballSecuritySkill(shooter),
    ballPressureSkill(defender),
    edge,
  )
  if (!game.rng.chance(chance)) return undefined
  const stealer = game.rng.chance(stealChance(defender, SHOOTER_STEAL_SHARE)) ? defender : undefined
  return recordTurnover(
    game,
    offense,
    defense,
    shooter,
    shooterTurnoverText(playType, received),
    stealer,
  )
}

/** Records an offensive foul's turnover (no steal; the foul itself is recorded by the caller). */
export function offensiveFoulTurnover(
  game: GameState,
  offense: TeamState,
  player: Player,
): ActionOutcome {
  lineOf(offense, player).turnovers += 1
  log(game, offense, `${shortName(player)} turnover (offensive foul)`)
  return { over: true, turnover: true, fastBreak: undefined }
}
