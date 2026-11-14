import { describe, expect, it } from 'vitest'
import {
  attributesAtLevel,
  fitLevel,
  generateMeasurables,
  generatePlayer,
  generatePotential,
  generateShape,
} from '../../../src/core/data/playerGenerator.ts'
import { VISIBLE_ATTRIBUTE_KEYS } from '../../../src/core/players/attributes.ts'
import { currentAbility } from '../../../src/core/players/currentAbility.ts'
import type { Position } from '../../../src/core/players/positions.ts'
import {
  HEIGHT_LIMITS,
  POSITIONS,
  positionRatings,
  primaryPosition,
} from '../../../src/core/players/positions.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { mean } from '../../helpers/simulation.ts'

/** Generates `count` players for one position and target CA from a fixed seed. */
function many(position: Position, count: number, targetCa = 60, seed = 17): Player[] {
  const rng = createRng(seed)
  return Array.from({ length: count }, (_, i) =>
    generatePlayer(rng, { id: `p${i}`, position, targetCa }),
  )
}

/** Mean of a value across players. */
function meanOf(players: readonly Player[], value: (p: Player) => number): number {
  return mean(players.map(value))
}

describe('generatePlayer', () => {
  it('is deterministic for the same seed and options', () => {
    const opts = { id: 'x', position: 'SF', targetCa: 72 } as const
    expect(generatePlayer(createRng(4), opts)).toEqual(generatePlayer(createRng(4), opts))
  })

  it('keeps every rating on its scale, even at extreme targets', () => {
    for (const targetCa of [1, 45, 75, 100]) {
      for (const position of POSITIONS) {
        for (const p of many(position, 40, targetCa)) {
          for (const key of VISIBLE_ATTRIBUTE_KEYS) {
            expect(Number.isInteger(p.attributes[key])).toBe(true)
            expect(p.attributes[key]).toBeGreaterThanOrEqual(1)
            expect(p.attributes[key]).toBeLessThanOrEqual(20)
          }
          const { currentAbility: ca, potential, ...rest } = p.hidden
          for (const v of Object.values(rest)) expect(v).toBeGreaterThanOrEqual(1)
          for (const v of Object.values(rest)) expect(v).toBeLessThanOrEqual(20)
          expect(potential).toBeGreaterThanOrEqual(ca)
          expect(potential).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('hits the target CA exactly, by design (CA is monotone and moves ≤ 1 per attribute point)', () => {
    const rng = createRng(99)
    for (let i = 0; i < 500; i++) {
      const targetCa = rng.nextInt(1, 100)
      const position = rng.pick(POSITIONS)
      const p = generatePlayer(rng, { id: `p${i}`, position, targetCa })
      // The stored CA is the computed one, never the rolled target.
      expect(p.hidden.currentAbility).toBe(currentAbility(p))
      expect(p.hidden.currentAbility).toBe(targetCa)
    }
  })

  it('makes a higher target a better player across the board', () => {
    const low = many('SG', 100, 45)
    const high = many('SG', 100, 85)
    const meanAttr = (p: Player): number => mean(VISIBLE_ATTRIBUTE_KEYS.map((k) => p.attributes[k]))
    expect(meanOf(high, meanAttr)).toBeGreaterThan(meanOf(low, meanAttr) + 3)
    expect(meanOf(high, (p) => p.attributes.threePoint)).toBeGreaterThan(
      meanOf(low, (p) => p.attributes.threePoint) + 3,
    )
  })

  it('builds players who mostly rate best at the position they were built for', () => {
    for (const position of POSITIONS) {
      const players = many(position, 200)
      const matching = players.filter((p) => primaryPosition(positionRatings(p)) === position)
      // Wings and forwards overlap with their neighbours by design (versatility), so ≥ 65%.
      expect(matching.length / players.length).toBeGreaterThan(0.65)
    }
  })

  it('shapes attributes by position: guards handle, centers block', () => {
    const guards = many('PG', 300)
    const centers = many('C', 300)
    expect(meanOf(guards, (p) => p.attributes.ballHandling)).toBeGreaterThan(
      meanOf(centers, (p) => p.attributes.ballHandling) + 5,
    )
    expect(meanOf(centers, (p) => p.attributes.shotBlocking)).toBeGreaterThan(
      meanOf(guards, (p) => p.attributes.shotBlocking) + 5,
    )
  })

  it('does not tie Leadership or Work Ethic to ability (they are not part of CA)', () => {
    const low = many('PF', 300, 45)
    const high = many('PF', 300, 90)
    for (const key of ['leadership', 'workEthic'] as const) {
      expect(
        Math.abs(meanOf(high, (p) => p.attributes[key]) - meanOf(low, (p) => p.attributes[key])),
      ).toBeLessThan(1)
    }
  })
})

describe('generateMeasurables', () => {
  it("always generates a height inside the position's hard limits", () => {
    const rng = createRng(12)
    for (const position of POSITIONS) {
      const { minCm, maxCm } = HEIGHT_LIMITS[position]
      for (let i = 0; i < 2000; i++) {
        const { heightCm } = generateMeasurables(rng, position)
        expect(heightCm).toBeGreaterThanOrEqual(minCm)
        expect(heightCm).toBeLessThanOrEqual(maxCm)
      }
    }
  })

  it('gives each position its body type, getting taller from PG to C', () => {
    // 400 players per position: SE of a mean height ≈ 4 / 20 = 0.2 cm, so ±1.5 cm is safe.
    const expected: Record<Position, number> = { PG: 189, SG: 195, SF: 201, PF: 206, C: 211 }
    for (const position of POSITIONS) {
      const rng = createRng(3)
      const bodies = Array.from({ length: 400 }, () => generateMeasurables(rng, position))
      expect(Math.abs(mean(bodies.map((b) => b.heightCm)) - expected[position])).toBeLessThan(1.5)
      for (const b of bodies) expect(b.wingspanCm).toBeGreaterThan(b.heightCm - 15)
    }
  })
})

describe('fitLevel', () => {
  it('finds a level whose computed CA equals every target from 1 to 100', () => {
    const rng = createRng(8)
    const measurables = generateMeasurables(rng, 'C')
    const shape = generateShape(rng, 'C')
    for (let target = 1; target <= 100; target++) {
      const attributes = attributesAtLevel(shape, fitLevel(shape, measurables, target))
      expect(currentAbility({ attributes, measurables })).toBe(target)
    }
  })
})

describe('generatePotential', () => {
  it('is never below CA or above 100, with more headroom for younger players', () => {
    const rng = createRng(5)
    const young = Array.from({ length: 400 }, () => generatePotential(rng, 50, 20) - 50)
    const veteran = Array.from({ length: 400 }, () => generatePotential(rng, 50, 30) - 50)
    expect(Math.min(...young)).toBeGreaterThanOrEqual(0)
    expect(mean(young)).toBeGreaterThan(5)
    expect(veteran.every((h) => h === 0)).toBe(true)
    expect(generatePotential(rng, 98, 19)).toBeLessThanOrEqual(100)
  })
})
