import { describe, expect, it } from 'vitest'
import type { Archetype } from '../../../src/core/data/playerGenerator.ts'
import {
  generateAttributes,
  generatePlayer,
  placeholderCurrentAbility,
} from '../../../src/core/data/playerGenerator.ts'
import { generateTeams, pickTeamNames } from '../../../src/core/data/teamGenerator.ts'
import { VISIBLE_ATTRIBUTE_KEYS } from '../../../src/core/players/attributes.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { flatAttributes } from '../../helpers/fixtures.ts'
import { mean } from '../../helpers/simulation.ts'

/** Generates `count` players of one archetype and quality from a fixed seed. */
function many(archetype: Archetype, count: number, quality = 10.5): Player[] {
  const rng = createRng(17)
  return Array.from({ length: count }, (_, i) =>
    generatePlayer(rng, { id: `p${i}`, archetype, quality }),
  )
}

/** Mean of one attribute across players. */
function meanOf(players: readonly Player[], value: (p: Player) => number): number {
  return mean(players.map(value))
}

const ARCHETYPES: readonly Archetype[] = ['guard', 'wing', 'big']

describe('generatePlayer', () => {
  it('is deterministic for the same seed and options', () => {
    const opts = { id: 'x', archetype: 'wing', quality: 12 } as const
    expect(generatePlayer(createRng(4), opts)).toEqual(generatePlayer(createRng(4), opts))
  })

  it('keeps every visible and hidden 1–20 rating on the scale, even at extreme quality', () => {
    for (const quality of [1, 10.5, 20]) {
      for (const archetype of ARCHETYPES) {
        for (const p of many(archetype, 100, quality)) {
          for (const key of VISIBLE_ATTRIBUTE_KEYS) {
            expect(Number.isInteger(p.attributes[key])).toBe(true)
            expect(p.attributes[key]).toBeGreaterThanOrEqual(1)
            expect(p.attributes[key]).toBeLessThanOrEqual(20)
          }
          const { currentAbility, potential, ...rest } = p.hidden
          for (const v of Object.values(rest)) expect(v).toBeGreaterThanOrEqual(1)
          for (const v of Object.values(rest)) expect(v).toBeLessThanOrEqual(20)
          expect(potential).toBeGreaterThanOrEqual(currentAbility)
          expect(potential).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('gives each archetype its body type (guard ≈ 191, wing ≈ 201, big ≈ 210 cm)', () => {
    // 400 players per archetype: SE of a mean height ≈ 4.5 / 20 ≈ 0.23 cm, so ±1.5 cm is safe.
    const expected: Record<Archetype, number> = { guard: 191, wing: 201, big: 210 }
    for (const archetype of ARCHETYPES) {
      const players = many(archetype, 400)
      expect(
        Math.abs(meanOf(players, (p) => p.measurables.heightCm) - expected[archetype]),
      ).toBeLessThan(1.5)
      for (const p of players)
        expect(p.measurables.wingspanCm).toBeGreaterThan(p.measurables.heightCm - 15)
    }
  })

  it('tilts the shape of ratings, not the level (archetype biases are centered)', () => {
    const levels = ARCHETYPES.map((a) =>
      meanOf(many(a, 300, 12), (p) => mean(VISIBLE_ATTRIBUTE_KEYS.map((k) => p.attributes[k]))),
    )
    for (const level of levels) expect(Math.abs(level - 12)).toBeLessThan(0.35)
    const guards = many('guard', 300)
    const bigs = many('big', 300)
    expect(meanOf(guards, (p) => p.attributes.ballHandling)).toBeGreaterThan(
      meanOf(bigs, (p) => p.attributes.ballHandling) + 4,
    )
    expect(meanOf(bigs, (p) => p.attributes.shotBlocking)).toBeGreaterThan(
      meanOf(guards, (p) => p.attributes.shotBlocking) + 4,
    )
  })

  it('makes higher-quality players better on average', () => {
    const low = many('wing', 200, 8)
    const high = many('wing', 200, 14)
    expect(meanOf(high, (p) => p.hidden.currentAbility)).toBeGreaterThan(
      meanOf(low, (p) => p.hidden.currentAbility) + 20,
    )
  })
})

describe('generateAttributes', () => {
  it('returns exactly the 30 visible attributes', () => {
    const attrs = generateAttributes(createRng(1), 'guard', 10.5)
    expect(Object.keys(attrs).sort()).toEqual([...VISIBLE_ATTRIBUTE_KEYS].sort())
  })
})

describe('placeholderCurrentAbility', () => {
  it('maps an average player to 50 and stays within 1–100', () => {
    expect(placeholderCurrentAbility(flatAttributes(10.5))).toBe(50)
    expect(placeholderCurrentAbility(flatAttributes(1))).toBeGreaterThanOrEqual(1)
    expect(placeholderCurrentAbility(flatAttributes(20))).toBeLessThanOrEqual(100)
    expect(placeholderCurrentAbility(flatAttributes(15))).toBeGreaterThan(
      placeholderCurrentAbility(flatAttributes(10)),
    )
  })
})

describe('team names and generateTeams', () => {
  it('picks distinct names and throws when asked for more than the pool', () => {
    const names = pickTeamNames(createRng(2), 10)
    expect(new Set(names).size).toBe(10)
    expect(() => pickTeamNames(createRng(2), 10_000)).toThrow(RangeError)
  })

  it('generates teams with unique ids and unique player ids', () => {
    const teams = generateTeams(createRng(8), 6)
    expect(new Set(teams.map((t) => t.id)).size).toBe(6)
    const playerIds = teams.flatMap((t) => t.roster.map((p) => p.id))
    expect(new Set(playerIds).size).toBe(playerIds.length)
  })
})
