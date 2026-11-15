import { describe, expect, it } from 'vitest'
import { generateTeam } from '../../../src/core/data/teamGenerator.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import type { FitDemand } from '../../../src/core/tactics/fit.ts'
import {
  FIT_DEMANDS,
  fitBasis,
  lineupFit,
  NO_FIT,
  optionFit,
  playerFit,
  roleTerm,
} from '../../../src/core/tactics/fit.ts'
import type { TeamSystem } from '../../../src/core/tactics/system.ts'
import { BALANCED_SYSTEM } from '../../../src/core/tactics/system.ts'
import { makePlayer } from '../../helpers/fixtures.ts'

/** A balanced system with some settings changed. */
function system(patch: Partial<TeamSystem>): TeamSystem {
  return { ...BALANCED_SYSTEM, ...patch }
}

/** A 198 cm wing who lives behind the arc. */
const SHOOTER = makePlayer({
  id: 'shooter',
  heightCm: 198,
  attributes: { threePoint: 18, offBallMovement: 16, freeThrow: 17, postScoring: 4, strength: 7 },
})

/** A 213 cm center who scores on the block and protects the rim, but can't shoot. */
const BIG = makePlayer({
  id: 'big',
  heightCm: 213,
  attributes: {
    postScoring: 17,
    strength: 17,
    interiorDefense: 17,
    shotBlocking: 17,
    defensiveRebounding: 16,
    threePoint: 3,
    perimeterDefense: 6,
  },
})

/** A copy of a player with `amount` added to every visible attribute (his shape unchanged). */
function levelledUp(player: Player, amount: number): Player {
  const attributes = { ...player.attributes }
  for (const key of Object.keys(attributes) as (keyof typeof attributes)[]) {
    attributes[key] = Math.min(20, attributes[key] + amount)
  }
  return { ...player, attributes }
}

/** Generated league players for the centering checks. */
function leaguePlayers(teams: number): Player[] {
  return Array.from(
    { length: teams },
    (_, i) => generateTeam(createRng(4_000 + i), { id: `t${i}` }).roster,
  ).flat()
}

describe('role/system fit', () => {
  it('asks nothing of anyone under the balanced system', () => {
    expect(playerFit(SHOOTER, BALANCED_SYSTEM)).toBe(NO_FIT)
    // The rotation settings have no engine effect, so no fit demands either.
    expect(playerFit(BIG, system({ rotationDepth: 'deep', starterMinutes: 'share' }))).toBe(NO_FIT)
  })

  it('a shooter fits a three-heavy system, a post big an inside-out one', () => {
    const threes = system({ shotProfile: 'threeHeavy' })
    const inside = system({ shotProfile: 'insideOut', primaryAction: 'postUps' })
    expect(playerFit(SHOOTER, threes).offense).toBeGreaterThan(0.3)
    expect(playerFit(BIG, threes).offense).toBeLessThan(-0.3)
    expect(playerFit(BIG, inside).offense).toBeGreaterThan(playerFit(SHOOTER, inside).offense)
  })

  it('a rim protector fits protect-the-paint, not run-shooters-off-the-line', () => {
    expect(playerFit(BIG, system({ helpPriority: 'protectPaint' })).defense).toBeGreaterThan(0.3)
    expect(playerFit(BIG, system({ helpPriority: 'runShooters' })).defense).toBeLessThan(0)
  })

  it('keeps fit on the −1 … +1 scale', () => {
    for (const player of [SHOOTER, BIG]) {
      const fit = playerFit(
        player,
        system({ shotProfile: 'threeHeavy', helpPriority: 'runShooters' }),
      )
      for (const value of [fit.offense, fit.defense]) {
        expect(Math.abs(value)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('scores the role part 0 for a wanted role and bottoms out for none', () => {
    const roles = [
      { role: 'Sharpshooter' as const, fit: 3 },
      { role: '3-and-D Wing' as const, fit: 2.5 },
    ]
    expect(roleTerm(roles, ['Sharpshooter'])).toBe(0)
    expect(roleTerm(roles, ['3-and-D Wing'])).toBeCloseTo(-0.5, 12)
    expect(roleTerm(roles, ['Rim Protector'])).toBe(-3)
  })

  it('depends on what a player does well, not how good he is', () => {
    // Raising every attribute keeps his shape: fit barely moves (only clamping at 20 and the
    // role skill floors can nudge it).
    const threes = system({ shotProfile: 'threeHeavy' })
    const base = playerFit(SHOOTER, threes).offense
    expect(Math.abs(playerFit(levelledUp(SHOOTER, 2), threes).offense - base)).toBeLessThan(0.15)
  })

  it('never reads Current Ability or Potential', () => {
    const changed = { ...BIG, hidden: { ...BIG.hidden, currentAbility: 99, potential: 1 } }
    const full = system({ shotProfile: 'insideOut', defensivePressure: 'aggressive' })
    expect(playerFit(changed, full)).toEqual(playerFit(BIG, full))
  })

  it('averages about zero over league players for every option (no free buff)', () => {
    const bases = leaguePlayers(40).map(fitBasis)
    for (const options of Object.values(FIT_DEMANDS)) {
      for (const demand of Object.values(options as Record<string, FitDemand>)) {
        const mean = bases.reduce((sum, basis) => sum + optionFit(basis, demand), 0) / bases.length
        expect(Math.abs(mean)).toBeLessThan(0.08)
      }
    }
  })

  it('ranks lineups by fit', () => {
    const threes = system({ shotProfile: 'threeHeavy' })
    expect(lineupFit([SHOOTER, SHOOTER], threes)).toBeGreaterThan(lineupFit([BIG, BIG], threes))
    expect(lineupFit([], threes)).toBe(0)
  })
})
