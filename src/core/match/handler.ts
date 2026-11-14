import type { Player } from '../players/types.ts'
import { normalizeRating } from '../shared/probability.ts'
import type { Rng } from '../shared/rng.ts'
import { pickWeighted } from '../shared/weighted.ts'
import { handlerSkill } from './ratings.ts'
import { HANDLER_PICK_WEIGHT } from './tuning.ts'

/**
 * Picks who brings the ball up and starts this action. Weighted toward Ball Handling, Passing
 * and Offensive IQ, so guards start most actions and throw most passes.
 */
export function pickHandler(rng: Rng, lineup: readonly Player[]): Player {
  // exp() of the normalized skill, like play selection: a uniformly better league keeps the same
  // distribution of who handles the ball.
  return pickWeighted(rng, lineup, (p) =>
    Math.exp(HANDLER_PICK_WEIGHT * normalizeRating(handlerSkill(p))),
  )
}
