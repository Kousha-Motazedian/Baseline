import type { Player } from '../players/types.ts'
import { AVERAGE_RATING, clamp } from '../shared/probability.ts'
import type { ActionOutcome } from './rebound.ts'
import { resolveRebound } from './rebound.ts'
import type { GameState, TeamState } from './state.ts'
import { addPoints, lineOf, log, shortName } from './state.ts'
import { BASE_FREE_THROW, FREE_THROW_PER_RATING_POINT } from './tuning.ts'

/** A player's chance to make a free throw. */
export function freeThrowChance(shooter: Player): number {
  // Linear in the rating (not log-odds): free throws are uncontested, so skill maps directly to %.
  // Rating 1 ≈ 61%, average ≈ 78%, rating 20 ≈ 95%.
  const rating = shooter.attributes.freeThrow
  return clamp(BASE_FREE_THROW + (rating - AVERAGE_RATING) * FREE_THROW_PER_RATING_POINT, 0.3, 0.97)
}

/** Shoots a set of free throws; if the last one misses, it's a live rebound. */
export function shootFreeThrows(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  shooter: Player,
  count: number,
): ActionOutcome {
  let lastMade = false
  for (let attempt = 1; attempt <= count; attempt++) {
    lastMade = game.rng.chance(freeThrowChance(shooter))
    const line = lineOf(offense, shooter)
    line.freeThrowsAttempted += 1
    if (lastMade) {
      line.freeThrowsMade += 1
      addPoints(game, offense, shooter, 1)
    }
    const result = lastMade ? 'makes' : 'misses'
    log(game, offense, `${shortName(shooter)} ${result} free throw ${attempt} of ${count}`)
  }
  return lastMade ? 'possessionOver' : resolveRebound(game, offense, defense, true)
}
