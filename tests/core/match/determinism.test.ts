import { describe, expect, it } from 'vitest'
import { simulateGame } from '../../../src/core/match/game.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { generatedPair } from '../../helpers/fixtures.ts'

describe('determinism', () => {
  it('replays an identical game (deep-equal, play-by-play included) for the same inputs', () => {
    for (const seed of [0, 1, 99, 123_456]) {
      const [home, away] = generatedPair(seed)
      const a = simulateGame({ home, away, rules: PRO_RULES, seed })
      const b = simulateGame({ home, away, rules: PRO_RULES, seed })
      expect(b).toEqual(a)
    }
  })

  it('produces different games for different seeds', () => {
    const [home, away] = generatedPair(4)
    const results = [1, 2, 3, 4, 5].map((seed) =>
      simulateGame({ home, away, rules: PRO_RULES, seed }),
    )
    const signatures = new Set(results.map((r) => JSON.stringify(r.playByPlay)))
    expect(signatures.size).toBe(results.length)
  })

  it('depends on the rules (same seed, different rules → different game)', () => {
    const [home, away] = generatedPair(4)
    const pro = simulateGame({ home, away, rules: PRO_RULES, seed: 8 })
    const fiba = simulateGame({ home, away, rules: FIBA_RULES, seed: 8 })
    expect(fiba).not.toEqual(pro)
  })

  it('keeps no hidden state between games (order of simulation does not matter)', () => {
    const [h1, a1] = generatedPair(10)
    const [h2, a2] = generatedPair(11)
    const alone = simulateGame({ home: h2, away: a2, rules: PRO_RULES, seed: 3 })
    simulateGame({ home: h1, away: a1, rules: PRO_RULES, seed: 2 })
    const after = simulateGame({ home: h2, away: a2, rules: PRO_RULES, seed: 3 })
    expect(after).toEqual(alone)
  })

  it('does not mutate the input teams or rules', () => {
    const [home, away] = generatedPair(12)
    const before = structuredClone({ home, away, rules: PRO_RULES })
    // Run several games so foul-outs (which change the live lineup) are likely to happen.
    for (let seed = 0; seed < 20; seed++) simulateGame({ home, away, rules: PRO_RULES, seed })
    expect({ home, away, rules: PRO_RULES }).toEqual(before)
  })

  it('returns plain data that survives a JSON round trip (safe for saves and workers)', () => {
    const [home, away] = generatedPair(13)
    const result = simulateGame({ home, away, rules: PRO_RULES, seed: 13 })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})
