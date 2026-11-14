import { describe, expect, it } from 'vitest'
import { generateLeague } from '../../../src/core/data/teamGenerator.ts'
import type { Measurables, VisibleAttributes } from '../../../src/core/players/attributes.ts'
import type { PlayerProfile } from '../../../src/core/players/positions.ts'
import {
  bodyFactor,
  formatPositions,
  HEIGHT_LIMITS,
  INELIGIBLE_RATING,
  isHeightEligible,
  POSITIONS,
  positionRating,
  positionRatings,
  positionsPlayed,
  primaryPosition,
} from '../../../src/core/players/positions.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { flatAttributes } from '../../helpers/fixtures.ts'

/** Measurables for a given height, with a typical +7 cm wingspan. */
function body(heightCm: number, wingspanExtraCm = 7): Measurables {
  return {
    heightCm,
    wingspanCm: heightCm + wingspanExtraCm,
    weightKg: 100,
    age: 26,
    dominantHand: 'right',
    nationality: 'Testland',
  }
}

/** A profile with flat attributes plus some overrides. */
function profile(
  heightCm: number,
  patch: Partial<VisibleAttributes> = {},
  base = 10,
  wingspanExtraCm = 7,
): PlayerProfile {
  return {
    attributes: { ...flatAttributes(base), ...patch },
    measurables: body(heightCm, wingspanExtraCm),
  }
}

/** Inside skills of an elite rebounder / rim protector. */
const INSIDE: Partial<VisibleAttributes> = {
  interiorDefense: 18,
  shotBlocking: 17,
  defensiveRebounding: 18,
  offensiveRebounding: 17,
  strength: 16,
  finishing: 15,
  vertical: 14,
  ballHandling: 6,
  passing: 7,
  threePoint: 6,
}

describe('position ratings', () => {
  it('rates a tall rebounder and rim protector as a C, far above PG', () => {
    const ratings = positionRatings(profile(213, INSIDE))
    expect(primaryPosition(ratings)).toBe('C')
    expect(ratings.C).toBeGreaterThan(ratings.PG + 6)
  })

  it('rates a small ball-handler as a PG', () => {
    const guard = profile(186, {
      ballHandling: 17,
      passing: 17,
      offensiveIq: 15,
      quickness: 15,
      speed: 15,
      shotBlocking: 4,
      interiorDefense: 5,
    })
    const ratings = positionRatings(guard)
    expect(primaryPosition(ratings)).toBe('PG')
    expect(ratings.PG).toBeGreaterThan(ratings.C + 6)
  })

  it('stays on the 1–20 scale where the height allows the position, 0 where it does not', () => {
    for (const rating of [1, 10, 20]) {
      for (const height of [170, 200, 230]) {
        const ratings = positionRatings(profile(height, {}, rating))
        for (const position of POSITIONS) {
          const value = ratings[position]
          if (!isHeightEligible(body(height), position)) {
            expect(value).toBe(INELIGIBLE_RATING)
            continue
          }
          expect(value).toBeGreaterThanOrEqual(1)
          expect(value).toBeLessThanOrEqual(20)
        }
      }
    }
  })

  it('treats height as a soft curve: a shorter center loses rating smoothly, never all of it', () => {
    const ratings: number[] = []
    // Inside the C height range (201–229 cm); below it the position is ruled out entirely.
    for (let height = 215; height >= 201; height--) {
      ratings.push(positionRating(profile(height, INSIDE), 'C'))
    }
    for (let i = 1; i < ratings.length; i++) {
      const drop = (ratings[i - 1] as number) - (ratings[i] as number)
      // Never rises as the player shrinks, and no single centimetre is a cliff.
      expect(drop).toBeGreaterThanOrEqual(0)
      expect(drop).toBeLessThan(1)
    }
    // Even at the 6'7" limit the soft curve keeps most of his rating: no cliff inside the range.
    expect(ratings[ratings.length - 1]).toBeGreaterThan(10)
  })

  it('lets a 6\'7" elite inside player be a decent small-ball center but never a great one', () => {
    const smallBall = profile(201, { ...INSIDE, interiorDefense: 20, defensiveRebounding: 20 })
    const rating = positionRating(smallBall, 'C')
    expect(rating).toBeGreaterThan(11)
    expect(rating).toBeLessThan(14)
    // Even with perfect attributes everywhere, a 6'7" center can't reach elite.
    expect(positionRating(profile(201, {}, 20), 'C')).toBeLessThan(17)
  })

  it('heavily penalises short centers but barely touches short point guards', () => {
    expect(bodyFactor(body(185), 'C')).toBeLessThan(0.5)
    expect(bodyFactor(body(178), 'PG')).toBeGreaterThan(0.9)
    expect(bodyFactor(body(213), 'C')).toBe(1)
  })

  it('counts long arms as extra height for bigs', () => {
    expect(bodyFactor(body(204, 16), 'C')).toBeGreaterThan(bodyFactor(body(204, 4), 'C'))
  })
})

describe('positions played', () => {
  it('adds the next-best position within 1.2 points, a second one only within 0.6', () => {
    expect(positionsPlayed({ PG: 9, SG: 13, SF: 14, PF: 12, C: 8 })).toEqual(['SG', 'SF'])
    expect(positionsPlayed({ PG: 9, SG: 13.5, SF: 14, PF: 13.5, C: 8 })).toEqual(['SG', 'SF', 'PF'])
    expect(positionsPlayed({ PG: 9, SG: 12.7, SF: 14, PF: 12.7, C: 8 })).toEqual(['SF'])
    expect(positionsPlayed({ PG: 9, SG: 13, SF: 14, PF: 13.1, C: 8 })).toEqual(['SF', 'PF'])
    expect(formatPositions(['SG', 'SF', 'PF'])).toBe('SG/SF/PF')
  })

  it('lists a non-adjacent near-tie, in PG–C display order, if the skipped position is passable', () => {
    // SF is within 1.2 of the best and the skipped SG within 1.5: a real PG/SF.
    expect(positionsPlayed({ PG: 14, SG: 12.6, SF: 13.5, PF: 5, C: 5 })).toEqual(['PG', 'SF'])
    // The primary can be the later position: still shown PG first.
    expect(positionsPlayed({ PG: 13.1, SG: 12, SF: 13.3, PF: 9, C: 5 })).toEqual(['PG', 'SF'])
  })

  it('never skips over a position the player cannot really play', () => {
    // Anyone who plays PG and SF can play SG: with SG 3 points back, SF is not listed.
    expect(positionsPlayed({ PG: 14, SG: 11, SF: 13.5, PF: 5, C: 5 })).toEqual(['PG'])
    expect(positionsPlayed({ PG: 13.1, SG: 9.9, SF: 13.3, PF: 9, C: 5 })).toEqual(['SF'])
  })

  it('requires every skipped position to be passable, and never skips a ruled-out one', () => {
    // PF skips SG and SF: both within 1.5 of 14 makes a PG/PF; one of them short does not.
    expect(positionsPlayed({ PG: 14, SG: 12.6, SF: 12.6, PF: 13.5, C: 5 })).toEqual(['PG', 'PF'])
    expect(positionsPlayed({ PG: 14, SG: 12.6, SF: 12.4, PF: 13.5, C: 5 })).toEqual(['PG'])
    // A rejected skip does not stop the search: C (skipping a poor PF) is out, but the lower,
    // adjacent SG is still listed as the first extra.
    expect(positionsPlayed({ PG: 14, SG: 13, SF: 12.6, PF: 11, C: 13.6 })).toEqual(['PG', 'SG'])
    // A middle position ruled out by height (rating 0) can never be bridged.
    expect(positionsPlayed({ PG: 14, SG: INELIGIBLE_RATING, SF: 13.5, PF: 5, C: 5 })).toEqual([
      'PG',
    ])
  })

  it('takes positions in rating order, so a skipped middle one does not block a better one', () => {
    // C (13.7) is the first extra; PF (12.6) would need to be within 0.6 of 14 and is not.
    expect(positionsPlayed({ PG: 5, SG: 5, SF: 14, PF: 12.6, C: 13.7 })).toEqual(['SF', 'C'])
  })

  it('keeps shrinking the margin beyond two extras (1.2, 0.6, 0.4, 0.3)', () => {
    // SG, SF and C tie at 13.65 (kept in PG–C order); C as the third extra needs ≥ 13.6 and makes
    // it, PF (13.62) as the fourth needs ≥ 13.7 and does not.
    const ratings = { PG: 14, SG: 13.65, SF: 13.65, PF: 13.62, C: 13.65 }
    expect(positionsPlayed(ratings)).toEqual(['PG', 'SG', 'SF', 'C'])
    expect(positionsPlayed({ PG: 14, SG: 14, SF: 14, PF: 14, C: 14 })).toEqual([...POSITIONS])
  })

  it('never plays a position his height rules out', () => {
    // A 7'6" player: only C is open, and 0-rated (ruled-out) spots never pass the margin.
    expect(positionsPlayed({ PG: 0, SG: 0, SF: 0, PF: 0, C: 1.5 })).toEqual(['C'])
    expect(positionsPlayed({ PG: 14, SG: INELIGIBLE_RATING, SF: 5, PF: 5, C: 5 })).toEqual(['PG'])
    // Even when every other rating is within the margin, the ruled-out SG never appears.
    expect(positionsPlayed({ PG: 1.1, SG: INELIGIBLE_RATING, SF: 1, PF: 1, C: 1 })).not.toContain(
      'SG',
    )
  })

  it('breaks exact ties towards the earlier position', () => {
    expect(primaryPosition({ PG: 12, SG: 12, SF: 5, PF: 5, C: 5 })).toBe('PG')
  })
})

describe('hard height limits', () => {
  it('allows a position exactly at its limits and rules it out 1 cm outside', () => {
    for (const position of POSITIONS) {
      const { minCm, maxCm } = HEIGHT_LIMITS[position]
      expect(isHeightEligible(body(minCm), position)).toBe(true)
      expect(isHeightEligible(body(maxCm), position)).toBe(true)
      // Below the lowest or above the highest limit overall, the nearest position stays open.
      if (minCm > 175) expect(isHeightEligible(body(minCm - 1), position)).toBe(false)
      if (maxCm < 229) expect(isHeightEligible(body(maxCm + 1), position)).toBe(false)
    }
  })

  it('never makes an out-of-range position primary, however good the skills', () => {
    // An elite rim protector at 6'6": C is ruled out (min 201 cm), so he is a PF at most.
    const ratings = positionRatings(profile(198, INSIDE))
    expect(ratings.C).toBe(INELIGIBLE_RATING)
    expect(primaryPosition(ratings)).not.toBe('C')
    expect(positionsPlayed(ratings)).not.toContain('C')
  })

  it('allows a 6\'7" (201 cm) center at the edge of the range', () => {
    const player = profile(201, INSIDE)
    expect(isHeightEligible(player.measurables, 'C')).toBe(true)
    expect(positionRating(player, 'C')).toBeGreaterThan(10)
  })

  it('gives very short and very tall players the nearest position instead of none', () => {
    expect(primaryPosition(positionRatings(profile(168)))).toBe('PG')
    expect(primaryPosition(positionRatings(profile(235)))).toBe('C')
  })

  it('keeps a 6\'7" elite playmaker a PG (the tall side of PG is a mild penalty)', () => {
    const playmaker = profile(
      201,
      {
        passing: 19,
        ballHandling: 18,
        offensiveIq: 19,
        driving: 17,
        threePoint: 15,
        midRange: 16,
        finishing: 15,
        quickness: 12,
        speed: 10,
        perimeterDefense: 9,
      },
      11,
      5,
    )
    const ratings = positionRatings(playmaker)
    expect(primaryPosition(ratings)).toBe('PG')
    expect(bodyFactor(playmaker.measurables, 'PG')).toBeGreaterThan(0.94)
    // The same player at other heights (exact results, quoted in player-roles.md).
    /** Positions played and primary position for the playmaker at a given height. */
    const at = (heightCm: number): [string, string] => {
      const p = {
        ...playmaker,
        measurables: { ...playmaker.measurables, heightCm, wingspanCm: heightCm + 5 },
      }
      const r = positionRatings(p)
      return [formatPositions(positionsPlayed(r)), primaryPosition(r)]
    }
    expect(at(188)).toEqual(['PG', 'PG'])
    expect(at(201)).toEqual(['PG/SG', 'PG'])
    expect(at(203)).toEqual(['PG/SG', 'PG'])
    // At 206 cm (the PG maximum) SG edges ahead (13.56 vs 13.40), but he still plays PG.
    expect(at(206)).toEqual(['PG/SG', 'SG'])
  })
})

describe('body factor soft curve', () => {
  const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const

  it('stays in (0, 1] and never changes by 10% or more per centimetre (no cliff)', () => {
    for (const position of POSITIONS) {
      let previous = bodyFactor(body(165), position)
      for (let height = 166; height <= 235; height++) {
        const factor = bodyFactor(body(height), position)
        expect(factor).toBeGreaterThan(0)
        expect(factor).toBeLessThanOrEqual(1)
        expect(Math.abs(factor - previous)).toBeLessThan(0.1)
        previous = factor
      }
    }
  })

  it('is 1 somewhere and falls off monotonically on both sides of the ideal range', () => {
    for (const position of POSITIONS) {
      const factors = Array.from({ length: 71 }, (_, i) => bodyFactor(body(165 + i), position))
      const peak = factors.indexOf(Math.max(...factors))
      expect(factors[peak]).toBe(1)
      for (let i = 1; i <= peak; i++) {
        expect(factors[i] as number).toBeGreaterThanOrEqual(factors[i - 1] as number)
      }
      for (let i = peak + 1; i < factors.length; i++) {
        expect(factors[i] as number).toBeLessThanOrEqual(factors[i - 1] as number)
      }
    }
  })

  it('orders ideal heights from PG to C', () => {
    const ideal = (position: (typeof POSITIONS)[number]): number => {
      const heights = Array.from({ length: 71 }, (_, i) => 165 + i)
      const ok = heights.filter((h) => bodyFactor(body(h), position) === 1)
      return ((ok[0] as number) + (ok[ok.length - 1] as number)) / 2
    }
    for (let i = 1; i < POSITIONS.length; i++) {
      expect(ideal(POSITIONS[i] as (typeof POSITIONS)[number])).toBeGreaterThan(
        ideal(POSITIONS[i - 1] as (typeof POSITIONS)[number]),
      )
    }
  })

  it('accepts height at SG at least as well as at PG at every height from 196 to 206 cm', () => {
    // Below 191 cm SG's short side is the harsher one by design (PG is the small spot), so the
    // check starts at PG's ideal maximum.
    for (let height = 196; height <= 206; height++) {
      expect(bodyFactor(body(height), 'SG')).toBeGreaterThanOrEqual(bodyFactor(body(height), 'PG'))
    }
  })

  it('never penalises a tall center, and only mildly penalises a tall point guard', () => {
    expect(bodyFactor(body(235), 'C')).toBe(1)
    expect(bodyFactor(body(206), 'PG')).toBeGreaterThan(0.55)
    expect(bodyFactor(body(206), 'PG')).toBeLessThan(1)
  })

  it('caps a perfectly skilled player by his body: a 6\'7" center cannot reach 17 at C', () => {
    expect(positionRating(profile(201, {}, 20), 'C')).toBeLessThan(17)
    expect(positionRating(profile(213, {}, 20), 'C')).toBe(20)
  })
})

describe('height limits across a generated league', () => {
  it('never lists a player at a position his height rules out, primary or played', () => {
    const players = generateLeague(createRng(77), 30).flatMap((t) => t.roster)
    for (const p of players) {
      const ratings = positionRatings(p)
      const played = positionsPlayed(ratings)
      expect(played).toContain(primaryPosition(ratings))
      for (const position of played) {
        expect({ id: p.id, position, ok: isHeightEligible(p.measurables, position) }).toEqual({
          id: p.id,
          position,
          ok: true,
        })
      }
    }
  })
})
