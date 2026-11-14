import type { Player } from '../players/types.ts'
import { AVERAGE_RATING, clamp, normalizeRating } from '../shared/probability.ts'
import type { ActionOutcome } from './outcome.ts'
import { possessionOver } from './outcome.ts'
import { resolveRebound } from './rebound.ts'
import type { GameState, TeamState } from './state.ts'
import { addPoints, isClutch, lineOf, log, shortName } from './state.ts'
import {
  BASE_FREE_THROW,
  CLUTCH_FREE_THROW_SWING,
  CLUTCH_MARGIN,
  CLUTCH_SECONDS,
  FREE_THROW_MAX_CHANCE,
  FREE_THROW_MIN_CHANCE,
  FREE_THROW_PER_RATING_POINT,
} from './tuning.ts'

/** A player's chance to make a free throw; in clutch time Composure moves it up or down. */
export function freeThrowChance(shooter: Player, clutch = false): number {
  // Linear in the rating (not log-odds): free throws are uncontested, so skill maps directly to %.
  // Rating 1 ≈ 61%, average ≈ 78%, rating 20 ≈ 95%.
  const rating = shooter.attributes.freeThrow
  const skill = BASE_FREE_THROW + (rating - AVERAGE_RATING) * FREE_THROW_PER_RATING_POINT
  // Pressure is symmetric around average Composure, so clutch time doesn't shift league FT%.
  const pressure = clutch
    ? CLUTCH_FREE_THROW_SWING * normalizeRating(shooter.attributes.composure)
    : 0
  return clamp(skill + pressure, FREE_THROW_MIN_CHANCE, FREE_THROW_MAX_CHANCE)
}

/** Shoots `count` free throws and records them; returns whether the last one went in. */
export function attemptFreeThrows(
  game: GameState,
  team: TeamState,
  shooter: Player,
  count: number,
  label = 'free throw',
): boolean {
  let lastMade = false
  const clutch = isClutch(game, CLUTCH_SECONDS, CLUTCH_MARGIN)
  for (let attempt = 1; attempt <= count; attempt++) {
    lastMade = game.rng.chance(freeThrowChance(shooter, clutch))
    const line = lineOf(team, shooter)
    line.freeThrowsAttempted += 1
    if (lastMade) {
      line.freeThrowsMade += 1
      addPoints(game, team, shooter, 1)
    }
    const result = lastMade ? 'makes' : 'misses'
    const ofCount = count > 1 ? ` ${attempt} of ${count}` : ''
    log(game, team, `${shortName(shooter)} ${result} ${label}${ofCount}`)
  }
  return lastMade
}

/** Shoots a trip of free throws for the offense; if the last one misses, it's a live rebound. */
export function shootFreeThrows(
  game: GameState,
  offense: TeamState,
  defense: TeamState,
  shooter: Player,
  count: number,
): ActionOutcome {
  const lastMade = attemptFreeThrows(game, offense, shooter, count)
  return lastMade ? possessionOver() : resolveRebound(game, offense, defense, 'freeThrow')
}

/** The best free-throw shooter in a lineup (first in lineup order on a tie). */
export function bestFreeThrowShooter(lineup: readonly Player[]): Player {
  return lineup.reduce((best, p) => (p.attributes.freeThrow > best.attributes.freeThrow ? p : best))
}

/** The worst free-throw shooter in a lineup: the target of an intentional foul. */
export function worstFreeThrowShooter(lineup: readonly Player[]): Player {
  return lineup.reduce((worst, p) =>
    p.attributes.freeThrow < worst.attributes.freeThrow ? p : worst,
  )
}
