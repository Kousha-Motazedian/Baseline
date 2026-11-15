import { describe, expect, it } from 'vitest'
import {
  coachingInputs,
  executionEdge,
  familiarityExposure,
} from '../../../src/core/tactics/coaching.ts'
import type { TeamSystem } from '../../../src/core/tactics/system.ts'
import { archetypeSystem, BALANCED_SYSTEM } from '../../../src/core/tactics/system.ts'
import { EXECUTION_EDGE } from '../../../src/core/tactics/tuning.ts'
import { makeCoach } from '../../helpers/coaching.ts'

/** The balanced system with some settings changed (the GM's overrides). */
function overridden(patch: Partial<TeamSystem>): TeamSystem {
  return { ...BALANCED_SYSTEM, ...patch }
}

describe('coachingInputs', () => {
  it('passes the system through and gives an average coach on his own system no edge', () => {
    const inputs = coachingInputs(
      makeCoach({ attributes: { offensiveCoaching: 10.5, defensiveCoaching: 10.5 } }),
      BALANCED_SYSTEM,
    )
    expect(inputs).toEqual({
      system: BALANCED_SYSTEM,
      offensiveExecution: 0,
      defensiveExecution: 0,
    })
  })

  it('keeps the full 1→20 coaching range modest and centered', () => {
    expect(executionEdge(20)).toBeCloseTo(EXECUTION_EDGE, 12)
    expect(executionEdge(10.5)).toBe(0)
    expect(executionEdge(1)).toBeCloseTo(-EXECUTION_EDGE, 12)
  })

  it('is monotonic in Offensive and Defensive Coaching, each on its own side', () => {
    let previous = coachingInputs(
      makeCoach({ attributes: { offensiveCoaching: 1, defensiveCoaching: 1 } }),
      BALANCED_SYSTEM,
    )
    for (let rating = 2; rating <= 20; rating++) {
      const next = coachingInputs(
        makeCoach({ attributes: { offensiveCoaching: rating, defensiveCoaching: 1 } }),
        BALANCED_SYSTEM,
      )
      expect(next.offensiveExecution).toBeGreaterThan(previous.offensiveExecution)
      expect(next.defensiveExecution).toBe(previous.defensiveExecution)
      previous = next
    }
    const lowD = coachingInputs(
      makeCoach({ attributes: { defensiveCoaching: 5 } }),
      BALANCED_SYSTEM,
    )
    const highD = coachingInputs(
      makeCoach({ attributes: { defensiveCoaching: 15 } }),
      BALANCED_SYSTEM,
    )
    expect(highD.defensiveExecution).toBeGreaterThan(lowD.defensiveExecution)
  })

  it('costs execution for every overridden setting, on that setting’s side only', () => {
    const coach = makeCoach()
    const own = coachingInputs(coach, BALANCED_SYSTEM)
    const one = coachingInputs(coach, overridden({ pace: 'fast' }))
    const two = coachingInputs(coach, overridden({ pace: 'fast', shotProfile: 'threeHeavy' }))
    expect(one.offensiveExecution).toBeLessThan(own.offensiveExecution)
    expect(two.offensiveExecution).toBeLessThan(one.offensiveExecution)
    expect(two.defensiveExecution).toBe(own.defensiveExecution)
    const defense = coachingInputs(coach, overridden({ helpPriority: 'protectPaint' }))
    expect(defense.defensiveExecution).toBeLessThan(own.defensiveExecution)
    expect(defense.offensiveExecution).toBe(own.offensiveExecution)
  })

  it('charges nothing for rotation overrides (no engine effect yet)', () => {
    const coach = makeCoach()
    const rotation = overridden({ rotationDepth: 'deep', starterMinutes: 'share' })
    expect(coachingInputs(coach, rotation)).toEqual({
      ...coachingInputs(coach, BALANCED_SYSTEM),
      system: rotation,
    })
  })

  it('costs adaptable and knowledgeable coaches less', () => {
    const forced = archetypeSystem('gritAndGrind')
    /** Offensive execution of a coach preferring the balanced system, forced into Grit and Grind. */
    const execution = (adaptability: number, tacticalKnowledge: number): number =>
      coachingInputs(makeCoach({ adaptability, attributes: { tacticalKnowledge } }), forced)
        .offensiveExecution
    for (let rating = 2; rating <= 20; rating++) {
      expect(execution(rating, 10)).toBeGreaterThan(execution(rating - 1, 10))
      expect(execution(10, rating)).toBeGreaterThan(execution(10, rating - 1))
    }
    expect(
      familiarityExposure(makeCoach({ adaptability: 20, attributes: { tacticalKnowledge: 20 } })),
    ).toBeCloseTo(0.2, 12)
    expect(
      familiarityExposure(makeCoach({ adaptability: 1, attributes: { tacticalKnowledge: 1 } })),
    ).toBe(1)
  })

  it('never reads Reputation', () => {
    const forced = archetypeSystem('smallBall')
    const unknown = coachingInputs(makeCoach({ reputation: 1 }), forced)
    const famous = coachingInputs(makeCoach({ reputation: 100 }), forced)
    expect(famous).toEqual(unknown)
  })
})
