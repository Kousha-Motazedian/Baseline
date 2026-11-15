import { describe, expect, it } from 'vitest'
import { createRng } from '../../../src/core/shared/rng.ts'
import type { SystemSetting } from '../../../src/core/tactics/system.ts'
import {
  archetypeSystem,
  BALANCED_SYSTEM,
  changedSettings,
  generateSystem,
  SETTING_OPTIONS,
  SYSTEM_ARCHETYPES,
} from '../../../src/core/tactics/system.ts'

describe('team systems', () => {
  it('has a balanced system with every setting at its neutral option', () => {
    expect(BALANCED_SYSTEM).toEqual({
      pace: 'balanced',
      shotProfile: 'balanced',
      ballMovement: 'balanced',
      primaryAction: 'driveAndKick',
      transition: 'balanced',
      offensiveRebounding: 'balanced',
      defensivePressure: 'balanced',
      helpPriority: 'balanced',
      rotationDepth: 'normal',
      starterMinutes: 'balanced',
    })
  })

  it('has exactly the six contract archetypes', () => {
    expect(SYSTEM_ARCHETYPES).toEqual([
      'paceAndSpace',
      'gritAndGrind',
      'motionOffense',
      'starDriven',
      'defensiveDisciplinarian',
      'smallBall',
    ])
  })

  it('gives archetypes coherent identities', () => {
    const space = archetypeSystem('paceAndSpace')
    expect([space.pace, space.shotProfile, space.transition]).toEqual([
      'fast',
      'threeHeavy',
      'push',
    ])
    expect(['motion', 'balanced']).toContain(space.ballMovement)
    const grit = archetypeSystem('gritAndGrind')
    expect(grit).toMatchObject({
      pace: 'slow',
      shotProfile: 'insideOut',
      primaryAction: 'postUps',
      transition: 'getBack',
      offensiveRebounding: 'crash',
      helpPriority: 'protectPaint',
    })
    expect(archetypeSystem('motionOffense').ballMovement).toBe('motion')
    expect(archetypeSystem('starDriven').ballMovement).toBe('isolation')
    expect(archetypeSystem('defensiveDisciplinarian').transition).toBe('getBack')
    expect(archetypeSystem('smallBall').pace).toBe('fast')
  })

  it('generates the same system from the same seed', () => {
    for (const archetype of SYSTEM_ARCHETYPES) {
      expect(generateSystem(createRng(5), archetype)).toEqual(
        generateSystem(createRng(5), archetype),
      )
    }
  })

  it('varies at most two settings, one step each, and only occasionally', () => {
    const rng = createRng(11)
    let varied = 0
    const trials = 600
    for (let i = 0; i < trials; i++) {
      const archetype = SYSTEM_ARCHETYPES[i % SYSTEM_ARCHETYPES.length] ?? 'paceAndSpace'
      const core = archetypeSystem(archetype)
      const system = generateSystem(rng, archetype)
      const changed = changedSettings(system, core)
      expect(changed.length).toBeLessThanOrEqual(2)
      if (changed.length > 0) varied++
      for (const setting of changed.filter((s: SystemSetting) => s !== 'primaryAction')) {
        const options = SETTING_OPTIONS[setting] as readonly string[]
        const step = options.indexOf(system[setting]) - options.indexOf(core[setting])
        expect(Math.abs(step)).toBe(1)
      }
    }
    // FIRST_VARIATION_CHANCE is 0.5.
    expect(varied / trials).toBeGreaterThan(0.4)
    expect(varied / trials).toBeLessThan(0.6)
  })

  it('lists the settings where a system differs from a reference', () => {
    const system = { ...BALANCED_SYSTEM, pace: 'fast' as const, rotationDepth: 'deep' as const }
    expect(changedSettings(system, BALANCED_SYSTEM)).toEqual(['pace', 'rotationDepth'])
  })
})
