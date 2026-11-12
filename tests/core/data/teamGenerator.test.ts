import { describe, expect, it } from 'vitest'
import { generateTeam } from '../../../src/core/data/teamGenerator.ts'
import { VISIBLE_ATTRIBUTE_KEYS } from '../../../src/core/players/attributes.ts'
import { createRng } from '../../../src/core/shared/rng.ts'

describe('generateTeam', () => {
  it('is deterministic for the same seed', () => {
    expect(generateTeam(createRng(9), { id: 'T' })).toEqual(generateTeam(createRng(9), { id: 'T' }))
  })

  it('builds a 10-man roster with ratings on the 1–20 scale', () => {
    const team = generateTeam(createRng(3), { id: 'T' })
    expect(team.roster).toHaveLength(10)
    for (const player of team.roster) {
      for (const key of VISIBLE_ATTRIBUTE_KEYS) {
        expect(player.attributes[key]).toBeGreaterThanOrEqual(1)
        expect(player.attributes[key]).toBeLessThanOrEqual(20)
      }
    }
  })

  it('starts guards in the first slots and a big in slot 5 (taller on average)', () => {
    let guardHeight = 0
    let bigHeight = 0
    for (let seed = 0; seed < 50; seed++) {
      const roster = generateTeam(createRng(seed), { id: 'T' }).roster
      guardHeight += roster[0]?.measurables.heightCm ?? 0
      bigHeight += roster[4]?.measurables.heightCm ?? 0
    }
    expect(bigHeight / 50 - guardHeight / 50).toBeGreaterThan(12)
  })
})
