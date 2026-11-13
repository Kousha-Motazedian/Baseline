import type { Player } from '../players/types.ts'
import { bestCandidate, eligibleBench, isDisqualified, isRegular, substitute } from './lineup.ts'
import type { GameState, TeamState } from './state.ts'
import { lineOf, log, shortName } from './state.ts'
import {
  FOUL_TROUBLE_CAUTION,
  FOUL_TROUBLE_MARGINS,
  FOUL_TROUBLE_MIN_FOULS,
  FOUL_TROUBLE_RELEASE_SECONDS,
} from './tuning.ts'

/**
 * STOPGAP — foul-trouble benching. Until rotations exist starters play the whole game, so
 * without this they foul out ~10x as often as real players. A player in foul trouble sits until
 * the next period (or the late-game release) and a reserve plays his slot.
 *
 * Replace this with the coach's rotation and foul-trouble settings in tactics/ once they exist,
 * then delete this module (and the `regulars` bookkeeping if rotations make it unnecessary).
 */

/** Fouls at which a player sits in the current period, or Infinity when nobody sits. */
export function foulTroubleThreshold(game: GameState): number {
  const { periods, personalFoulLimit } = game.rules
  // Late in the final regulation period and in overtime every player is needed: nobody sits.
  if (game.period > periods) return Infinity
  if (game.period === periods && game.clock <= FOUL_TROUBLE_RELEASE_SECONDS) return Infinity
  // The final regulation period always uses the last margin (one foul from disqualification);
  // earlier periods step through the table.
  const last = FOUL_TROUBLE_MARGINS.length - 1
  const index = game.period === periods ? last : Math.min(game.period - 1, last)
  const margin = FOUL_TROUBLE_MARGINS[index] ?? 1
  return Math.max(FOUL_TROUBLE_MIN_FOULS, personalFoulLimit - margin)
}

/** True if the player has too many fouls to play right now (disqualified players aren't "resting"). */
export function sitsForFouls(game: GameState, team: TeamState, player: Player): boolean {
  if (isDisqualified(team, player)) return false
  const threshold = foulTroubleThreshold(game)
  // A threshold at or past the limit would only ever fire on a disqualification: ignore it.
  if (threshold >= game.rules.personalFoulLimit) return false
  return lineOf(team, player).personalFouls >= threshold
}

/**
 * Log-odds change (zero or negative) in how likely a player is to commit a foul: one foul from
 * disqualification he plays it safe (no reaching, no risky contests, no charging in). Benching
 * alone can't stop foul-outs because nobody sits late in the game; the caution covers the
 * minutes he still plays.
 */
export function foulCautionEdge(game: GameState, team: TeamState, player: Player): number {
  if (isDisqualified(team, player)) return 0
  const oneAway = lineOf(team, player).personalFouls >= game.rules.personalFoulLimit - 1
  return oneAway ? -FOUL_TROUBLE_CAUTION : 0
}

/** True if the player can take the floor now: not disqualified and not sitting with fouls. */
function canPlay(game: GameState, team: TeamState, player: Player): boolean {
  return !isDisqualified(team, player) && !sitsForFouls(game, team, player)
}

/**
 * A reserve to fill in for a player sitting with fouls: free to play and not another slot's
 * regular (regulars on the bench are resting too), closest in height.
 */
function reserveFor(game: GameState, team: TeamState, player: Player): Player | undefined {
  return bestCandidate(eligibleBench(team), player, (p) =>
    !isRegular(team, p) && canPlay(game, team, p) ? 0 : undefined,
  )
}

/** Brings a slot's regular back once he is free to play again. Returns true if he came back. */
function returnRegular(game: GameState, team: TeamState, slot: number): boolean {
  const regular = team.regulars[slot]
  const current = team.onCourt[slot]
  if (!regular || !current || current === regular) return false
  if (team.onCourt.includes(regular) || !canPlay(game, team, regular)) return false
  substitute(team, slot, regular)
  log(game, team, `${shortName(regular)} checks in for ${shortName(current)}`)
  return true
}

/** Sits the player in a slot if he's in foul trouble and a reserve is free to replace him. */
function restIfInTrouble(game: GameState, team: TeamState, slot: number): void {
  const current = team.onCourt[slot]
  if (!current || !sitsForFouls(game, team, current)) return
  const reserve = reserveFor(game, team, current)
  // Only when a bench player exists: otherwise he plays on through the foul trouble.
  if (!reserve) return
  substitute(team, slot, reserve)
  const fouls = lineOf(team, current).personalFouls
  log(game, team, `${shortName(current)} sits with ${fouls} fouls; ${shortName(reserve)} checks in`)
}

/**
 * STOPGAP: applies foul-trouble benching to a team's lineup. Called at every dead ball the
 * engine knows about (each possession start, and right after each foul), so a regular returns at
 * the first possession of a new period or once the late-game release kicks in.
 */
export function updateFoulTroubleBench(game: GameState, team: TeamState): void {
  for (let slot = 0; slot < team.onCourt.length; slot++) {
    if (!returnRegular(game, team, slot)) restIfInTrouble(game, team, slot)
  }
}
