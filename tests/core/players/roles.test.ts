import { describe, expect, it } from 'vitest'
import type { VisibleAttributes } from '../../../src/core/players/attributes.ts'
import type { PlayerProfile } from '../../../src/core/players/positions.ts'
import type { RoleFit } from '../../../src/core/players/roles.ts'
import {
  areDistinctRoles,
  normPosition,
  playerRoles,
  ROLE_NAMES,
  ROLE_TEMPLATES,
  roleCount,
  roleFits,
  secondRoleFit,
  SUPERSTAR_SECOND_ROLE_CLOSENESS,
} from '../../../src/core/players/roles.ts'
import { makePlayer } from '../../helpers/fixtures.ts'

/** A test player of a given height with flat attributes plus overrides. */
function player(heightCm: number, patch: Partial<VisibleAttributes>, rating = 9): PlayerProfile {
  return makePlayer({ id: 'x', rating, heightCm, attributes: patch })
}

/** Builds a fit list from plain numbers. */
function fits(...values: number[]): RoleFit[] {
  return values.map((fit, i) => ({ role: ROLE_NAMES[i] as RoleFit['role'], fit }))
}

describe('role templates', () => {
  it('defines the 14 roles from the design doc, once each', () => {
    expect(ROLE_TEMPLATES.map((t) => t.name)).toEqual([...ROLE_NAMES])
    expect(ROLE_NAMES).toHaveLength(14)
  })
})

describe('role selection', () => {
  it('makes a tall shot-blocker a Rim Protector', () => {
    const big = player(213, {
      shotBlocking: 18,
      interiorDefense: 17,
      defensiveRebounding: 16,
      vertical: 13,
      strength: 13,
    })
    expect(playerRoles(big, 60)).toEqual(['Rim Protector'])
  })

  it('makes a pure passing point guard a Floor General', () => {
    const pg = player(186, {
      passing: 18,
      offensiveIq: 17,
      ballHandling: 17,
      teamwork: 15,
      quickness: 13,
      speed: 13,
    })
    expect(playerRoles(pg, 60)).toEqual(['Floor General'])
  })

  it('makes a perimeter stopper who cannot score a Lockdown Defender', () => {
    const stopper = player(198, {
      perimeterDefense: 18,
      quickness: 16,
      stealing: 16,
      defensiveIq: 16,
      driving: 7,
      midRange: 7,
      threePoint: 7,
      finishing: 7,
    })
    expect(playerRoles(stopper, 60)).toEqual(['Lockdown Defender'])
  })

  it('only offers roles open to the positions the player can play', () => {
    const big = player(213, { shotBlocking: 18, interiorDefense: 17, defensiveRebounding: 16 })
    const offered = roleFits(big).map((f) => f.role)
    expect(offered).not.toContain('Floor General')
    expect(offered).not.toContain('Sharpshooter')
    expect(offered).toContain('All-Around')
  })

  it('sorts fits best first', () => {
    const list = roleFits(player(200, { threePoint: 16 }))
    for (let i = 1; i < list.length; i++) {
      expect((list[i - 1] as RoleFit).fit).toBeGreaterThanOrEqual((list[i] as RoleFit).fit)
    }
  })
})

describe('role count', () => {
  it('always gives Generational and GOAT players two roles', () => {
    expect(roleCount(90, fits(15, 10))).toBe(2)
    expect(roleCount(100, fits(15, 3))).toBe(2)
  })

  it('gives a superstar a second role only when it fits almost as well as the first', () => {
    expect(roleCount(85, fits(15, 15 - SUPERSTAR_SECOND_ROLE_CLOSENESS * 0.99))).toBe(2)
    expect(roleCount(85, fits(15, 15 - SUPERSTAR_SECOND_ROLE_CLOSENESS - 0.01))).toBe(1)
  })

  it('gives everyone below 80 one role, however close the runner-up', () => {
    expect(roleCount(79, fits(15, 15))).toBe(1)
    expect(roleCount(40, fits(15, 15))).toBe(1)
  })

  it('never invents a second role when only one is available', () => {
    expect(roleCount(95, fits(15))).toBe(1)
  })

  it('returns the two best roles for a generational player', () => {
    const star = player(200, { threePoint: 18, perimeterDefense: 18, driving: 17 }, 15)
    const roles = playerRoles(star, 95)
    const best = roleFits(star)
      .slice(0, 2)
      .map((f) => f.role)
    expect(roles).toEqual(best)
  })

  it('is computed from attributes: the same player always gets the same roles', () => {
    const p = player(201, { threePoint: 15, perimeterDefense: 14 })
    expect(playerRoles(p)).toEqual(playerRoles(p))
  })
})

describe('role count at the tier boundaries', () => {
  const close = fits(15, 15 - SUPERSTAR_SECOND_ROLE_CLOSENESS / 2)
  const far = fits(15, 12)

  it('switches on the second role exactly at CA 80 (close runner-up) and CA 90 (any runner-up)', () => {
    expect(roleCount(79, close)).toBe(1)
    expect(roleCount(80, close)).toBe(2)
    expect(roleCount(89, far)).toBe(1)
    expect(roleCount(90, far)).toBe(2)
  })

  it('keeps a superstar at one role across the whole 80–89 band when the runner-up is far', () => {
    for (let ca = 80; ca <= 89; ca++) expect(roleCount(ca, far)).toBe(1)
  })

  it('never gives more than two roles, even to a GOAT with many close fits', () => {
    expect(roleCount(100, fits(15, 15, 15, 15))).toBe(2)
  })
})

/** The template for a role name (throws if missing, a test bug). */
function template(name: RoleFit['role']): (typeof ROLE_TEMPLATES)[number] {
  const found = ROLE_TEMPLATES.find((t) => t.name === name)
  if (!found) throw new Error(`no template ${name}`)
  return found
}

describe('roles are judged at their own position', () => {
  it('uses the role position nearest the primary one', () => {
    expect(normPosition(template('Rim Protector'), 'SF')).toBe('PF')
    expect(normPosition(template('Rim Protector'), 'C')).toBe('C')
    expect(normPosition(template('Scoring Guard'), 'SF')).toBe('SG')
    expect(normPosition(template('All-Around'), 'PF')).toBe('PF')
  })
})

describe('labels match the ratings', () => {
  it("never calls a center who can't shoot a Stretch Big, however poor the other centers are", () => {
    // 3PT 8 is far above a typical center's, but below the floor a "Stretch Big" promises.
    const big = player(213, { threePoint: 8, midRange: 9, shotBlocking: 11, postScoring: 11 }, 10)
    expect(playerRoles(big, 60)).not.toContain('Stretch Big')
  })

  it('makes a center who really shoots a Stretch Big', () => {
    const big = player(213, { threePoint: 15, midRange: 14, freeThrow: 13 }, 10)
    expect(playerRoles(big, 60)).toEqual(['Stretch Big'])
  })
})

describe('two-role pairs', () => {
  it('treats same-family roles as one strength said twice', () => {
    expect(areDistinctRoles('Sharpshooter', 'Stretch Big')).toBe(false)
    expect(areDistinctRoles('Point Forward', 'Playmaking Big')).toBe(false)
    expect(areDistinctRoles('Lockdown Defender', '3-and-D Wing')).toBe(false)
  })

  it('treats roles that contradict each other as no pair', () => {
    // A Rim Runner is expected to lack the shooting a Stretch Big is built on.
    expect(areDistinctRoles('Rim Runner', 'Stretch Big')).toBe(false)
    expect(areDistinctRoles('Stretch Big', 'Rim Runner')).toBe(false)
  })

  it('accepts genuinely different strengths', () => {
    expect(areDistinctRoles('Floor General', 'Scoring Guard')).toBe(true)
    expect(areDistinctRoles('Post Scorer', 'Rim Protector')).toBe(true)
  })

  it('skips redundant runners-up when picking the second role', () => {
    const list: RoleFit[] = [
      { role: 'Sharpshooter', fit: 15 },
      { role: 'Stretch Big', fit: 14.9 },
      { role: 'Slasher', fit: 12 },
    ]
    expect(secondRoleFit(list)?.role).toBe('Slasher')
    // Superstar: the distinct runner-up is 3 points back, so only one role.
    expect(roleCount(85, list)).toBe(1)
    expect(roleCount(95, list)).toBe(2)
  })

  it('gives a GOAT one role when no distinct second role exists', () => {
    const list: RoleFit[] = [
      { role: 'Sharpshooter', fit: 15 },
      { role: 'Stretch Big', fit: 14.9 },
    ]
    expect(roleCount(100, list)).toBe(1)
  })
})
