import type { Rng } from '../shared/rng.ts'
import { choosePlay } from './playSelection.ts'
import type { ActionOutcome } from './rebound.ts'
import { resolveShot } from './shot.ts'
import type { GameState, TeamState } from './state.ts'
import { runClock } from './state.ts'
import { tryTurnover } from './turnover.ts'
import {
  POSSESSION_MIN_SECONDS,
  POSSESSION_SPREAD_SECONDS,
  PUTBACK_MIN_SECONDS,
  PUTBACK_SPREAD_SECONDS,
} from './tuning.ts'

/** How many seconds an action takes before the shot or turnover, capped by the shot clock. */
export function actionSeconds(rng: Rng, isSecondChance: boolean, shotClock: number): number {
  const min = isSecondChance ? PUTBACK_MIN_SECONDS : POSSESSION_MIN_SECONDS
  const spread = isSecondChance ? PUTBACK_SPREAD_SECONDS : POSSESSION_SPREAD_SECONDS
  // Averaging two random rolls makes medium-length possessions most common and very quick
  // or very long ones rarer, which matches how real possessions are distributed.
  const seconds = min + ((rng.next() + rng.next()) / 2) * spread
  return Math.min(seconds, shotClock)
}

/** Runs one action: the play is chosen, time runs, then it ends in a turnover or a shot. */
function runAction(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  isSecondChance: boolean,
): ActionOutcome {
  const shotClock = isSecondChance
    ? game.rules.offensiveReboundShotClockSeconds
    : game.rules.shotClockSeconds
  runClock(game, actionSeconds(game.rng, isSecondChance, shotClock))

  const { player, playType, contesters } = choosePlay(game.rng, offense, defense)
  if (tryTurnover(game, offense, defense, player, contesters.defender)) return 'possessionOver'
  return resolveShot({ game, offense, defense, shooter: player, contesters, playType })
}

/** Simulates one full possession, including any second chances from offensive rebounds. */
export function simulatePossession(game: GameState, offense: TeamState, defense: TeamState): void {
  offense.possessions += 1
  let isSecondChance = false
  // An offensive rebound keeps the same possession going; it ends on a score, turnover,
  // defensive rebound, or when the period clock runs out.
  while (game.clock > 0) {
    const outcome = runAction(game, offense, defense, isSecondChance)
    if (outcome === 'possessionOver') return
    isSecondChance = true
  }
}
