/** Heavy-usage damping: a player who has already shot a lot is picked less often (playSelection.ts). */
import { describe, expect, it } from 'vitest'
import { choosePlay } from '../../../src/core/match/playSelection.ts'
import { lineOf } from '../../../src/core/match/state.ts'
import { HEAVY_USAGE_SHOTS } from '../../../src/core/match/tuning.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { makeGameState } from '../../helpers/gameState.ts'
import { generatedPair } from '../../helpers/fixtures.ts'

/** Share of 4,000 shooter picks that go to the first player on the floor, given his shots so far. */
function pickShare(shotsSoFar: number): number {
  const [home, away] = generatedPair(11)
  const game = makeGameState({ home, away, form: 0 })
  const star = game.home.onCourt[0]
  if (!star) throw new Error('no player on court')
  lineOf(game.home, star).fieldGoalsAttempted = shotsSoFar
  const rng = createRng(99)
  let picked = 0
  const trials = 4000
  for (let i = 0; i < trials; i++) {
    if (choosePlay(rng, game.home, game.away).player.id === star.id) picked++
  }
  return picked / trials
}

describe('heavy-usage damping', () => {
  it('leaves a player at or below the threshold untouched', () => {
    expect(pickShare(HEAVY_USAGE_SHOTS)).toBeCloseTo(pickShare(0), 10)
  })

  it('picks a player markedly less once he has taken many shots', () => {
    const fresh = pickShare(HEAVY_USAGE_SHOTS)
    expect(pickShare(HEAVY_USAGE_SHOTS + 8)).toBeLessThan(fresh * 0.85)
    expect(pickShare(HEAVY_USAGE_SHOTS + 20)).toBeLessThan(pickShare(HEAVY_USAGE_SHOTS + 8))
  })
})
