import { describe, expect, it } from 'vitest'
import type { VisibleAttributes } from '../../../src/core/players/attributes.ts'
import { VISIBLE_ATTRIBUTE_KEYS } from '../../../src/core/players/attributes.ts'
import { generateLeague } from '../../../src/core/data/teamGenerator.ts'
import {
  abilityScore,
  bodyAdjustedScore,
  CA_MAX_STEP,
  CA_WEIGHTS,
  caTier,
  currentAbility,
  scoreToCurrentAbility,
} from '../../../src/core/players/currentAbility.ts'
import type { PlayerProfile } from '../../../src/core/players/positions.ts'
import { isHeightEligible, POSITIONS } from '../../../src/core/players/positions.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { makePlayer } from '../../helpers/fixtures.ts'

/** A 200 cm test player with flat attributes plus overrides. */
function player(patch: Partial<VisibleAttributes> = {}, rating = 10): PlayerProfile {
  return makePlayer({ id: 'x', rating, attributes: patch })
}

describe('currentAbility', () => {
  it('ignores Leadership and Work Ethic completely', () => {
    const base = currentAbility(player())
    expect(currentAbility(player({ leadership: 20, workEthic: 20 }))).toBe(base)
    expect(currentAbility(player({ leadership: 1, workEthic: 1 }))).toBe(base)
    for (const position of POSITIONS) {
      expect(CA_WEIGHTS[position].leadership).toBe(0)
      expect(CA_WEIGHTS[position].workEthic).toBe(0)
    }
  })

  it('ignores hidden attributes', () => {
    const p = makePlayer({ id: 'x', consistency: 20 })
    const q = makePlayer({ id: 'x', consistency: 1 })
    expect(currentAbility(p)).toBe(currentAbility(q))
  })

  it('gives Stamina and Durability only light weight', () => {
    for (const position of POSITIONS) {
      const weights = CA_WEIGHTS[position]
      expect(weights.stamina).toBeLessThan(weights.offensiveIq as number)
      expect(weights.durability).toBeLessThan(weights.driving as number)
      expect(weights.stamina).toBeGreaterThan(0)
    }
  })

  it('rises when attributes rise and stays within 1–100', () => {
    expect(currentAbility(player({}, 14))).toBeGreaterThan(currentAbility(player({}, 10)))
    expect(currentAbility(player({}, 1))).toBeGreaterThanOrEqual(1)
    expect(currentAbility(player({}, 20))).toBe(100)
  })

  it("counts a position's key skills more than skills it rarely uses", () => {
    // At the same position (C), +6 shot blocking is worth more than +6 ball handling.
    const blocker = player({ shotBlocking: 16 })
    const handler = player({ ballHandling: 16 })
    expect(abilityScore(blocker, 'C')).toBeGreaterThan(abilityScore(handler, 'C'))
    expect(abilityScore(handler, 'PG')).toBeGreaterThan(abilityScore(blocker, 'PG'))
  })

  it('counts every on-court visible attribute at every position', () => {
    for (const position of POSITIONS) {
      for (const key of VISIBLE_ATTRIBUTE_KEYS) {
        if (key === 'leadership' || key === 'workEthic') continue
        expect(CA_WEIGHTS[position][key]).toBeGreaterThan(0)
      }
    }
  })
})

describe('scoreToCurrentAbility and caTier', () => {
  it('maps scores monotonically and clamps to 1–100', () => {
    expect(scoreToCurrentAbility(1)).toBe(1)
    expect(scoreToCurrentAbility(20)).toBe(100)
    expect(scoreToCurrentAbility(12)).toBeGreaterThan(scoreToCurrentAbility(11))
  })

  it('names tiers by their lower bounds', () => {
    expect(caTier(100)).toBe('GOAT')
    expect(caTier(99)).toBe('Generational')
    expect(caTier(80)).toBe('Superstar')
    expect(caTier(79)).toBe('All-Star')
    expect(caTier(60)).toBe('Quality starter')
    expect(caTier(50)).toBe('Rotation player')
    expect(caTier(40)).toBe('End of bench')
    expect(caTier(5)).toBe('Youth prospect')
  })
})

describe('CA continuity', () => {
  it('never falls when any attribute that counts toward CA rises by 1', () => {
    const players = generateLeague(createRng(21), 30).flatMap((t) => t.roster)
    let checks = 0
    for (const p of players) {
      const base = currentAbility(p)
      for (const key of VISIBLE_ATTRIBUTE_KEYS) {
        if (p.attributes[key] >= 20) continue
        const raised = { ...p, attributes: { ...p.attributes, [key]: p.attributes[key] + 1 } }
        expect(currentAbility(raised)).toBeGreaterThanOrEqual(base)
        checks++
      }
    }
    expect(checks).toBeGreaterThan(10_000)
  })

  it('moves at most one CA point per attribute point (what lets the generator hit any target)', () => {
    expect(CA_MAX_STEP).toBeLessThan(1)
  })

  it('does not flip with the primary position: a borderline C/PF changes smoothly', () => {
    // Raise Finishing one point at a time on a 206 cm big; CA may only stay or go up.
    let previous = 0
    for (let finishing = 1; finishing <= 20; finishing++) {
      const ca = currentAbility(
        makePlayer({ id: 'x', rating: 11, heightCm: 206, attributes: { finishing } }),
      )
      expect(ca).toBeGreaterThanOrEqual(previous)
      previous = ca
    }
  })
})

describe('CA and the hard height limits', () => {
  /** An elite inside player (rim protection, rebounding, strength) at a given height. */
  function insideBig(heightCm: number): PlayerProfile {
    const inside: Partial<VisibleAttributes> = {
      interiorDefense: 20,
      shotBlocking: 20,
      defensiveRebounding: 20,
      offensiveRebounding: 20,
      strength: 20,
      finishing: 18,
      vertical: 18,
    }
    const p = makePlayer({ id: 'x', rating: 6, heightCm, attributes: inside })
    // Very long arms: at C his reach would make up for the height, if C were allowed.
    return { ...p, measurables: { ...p.measurables, wingspanCm: heightCm + 20 } }
  }

  it('only counts positions the height allows: a 200 cm big is not scored as a C', () => {
    const big = insideBig(200)
    expect(isHeightEligible(big.measurables, 'C')).toBe(false)
    const eligible = POSITIONS.filter((p) => isHeightEligible(big.measurables, p))
    const best = Math.max(...eligible.map((p) => bodyAdjustedScore(big, p)))
    expect(currentAbility(big)).toBe(scoreToCurrentAbility(best))
    // Scored at C he would rate higher, so the limit really changes his CA.
    expect(scoreToCurrentAbility(bodyAdjustedScore(big, 'C'))).toBeGreaterThan(currentAbility(big))
  })

  it('scores a 214 cm player at C only, the one position his height allows', () => {
    const giant = insideBig(214)
    const eligible = POSITIONS.filter((p) => isHeightEligible(giant.measurables, p))
    expect(eligible).toEqual(['C'])
    expect(currentAbility(giant)).toBe(scoreToCurrentAbility(bodyAdjustedScore(giant, 'C')))
  })
})
