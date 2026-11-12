import { describe, expect, it } from 'vitest'
import { generateTeam } from '../../../src/core/data/teamGenerator.ts'
import { playWeight } from '../../../src/core/match/playSelection.ts'
import { HALF_COURT_PLAY_TYPES } from '../../../src/core/match/types.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { VISIBLE_ATTRIBUTE_KEYS } from '../../../src/core/players/attributes.ts'
import { createRng } from '../../../src/core/shared/rng.ts'

/** A copy of a player with every visible attribute raised by `amount`. */
function boosted(player: Player, amount: number): Player {
  const attributes = { ...player.attributes }
  for (const key of VISIBLE_ATTRIBUTE_KEYS) attributes[key] += amount
  return { ...player, attributes }
}

describe('playWeight', () => {
  it('scales every option by the same factor when both ends improve equally', () => {
    const [shooter, defender, rimProtector] = generateTeam(createRng(5), { id: 'T' }).roster as [
      Player,
      Player,
      Player,
    ]
    const ratios = HALF_COURT_PLAY_TYPES.map(
      (type) =>
        playWeight(boosted(shooter, 3), type, {
          defender: boosted(defender, 3),
          rimProtector: boosted(rimProtector, 3),
        }) / playWeight(shooter, type, { defender, rimProtector }),
    )
    for (const ratio of ratios) expect(ratio).toBeCloseTo(ratios[0] ?? 0, 9)
  })

  it('runs a play less often against a better defender', () => {
    const [shooter, defender, rimProtector] = generateTeam(createRng(5), { id: 'T' }).roster as [
      Player,
      Player,
      Player,
    ]
    const normal = playWeight(shooter, 'three', { defender, rimProtector })
    const tough = playWeight(shooter, 'three', { defender: boosted(defender, 4), rimProtector })
    expect(tough).toBeLessThan(normal)
  })
})
