/**
 * Property-based fuzzing: random rosters (any size 5–13, any attribute 1–20, any height, any
 * Consistency) under random rule sets must always produce a valid game. This catches crashes and
 * bookkeeping errors that hand-picked fixtures miss.
 */
import { describe, it } from 'vitest'
import { simulateGame } from '../../../src/core/match/game.ts'
import type { MatchTeam } from '../../../src/core/match/types.ts'
import { VISIBLE_ATTRIBUTE_KEYS } from '../../../src/core/players/attributes.ts'
import type { VisibleAttributes } from '../../../src/core/players/attributes.ts'
import type { Rng } from '../../../src/core/shared/rng.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import type { LeagueRules } from '../../../src/core/world/rules.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { makePlayer } from '../../helpers/fixtures.ts'
import { expectValidResult } from '../../helpers/invariants.ts'
import { SLOW_TEST_TIMEOUT_MS } from '../../helpers/simulation.ts'

/** Games to fuzz. ~150 keeps this file around a second; raise locally when hunting bugs. */
const FUZZ_GAMES = 150

/** Uniformly random attributes on the full 1–20 scale. */
function randomAttributes(rng: Rng): VisibleAttributes {
  return Object.fromEntries(
    VISIBLE_ATTRIBUTE_KEYS.map((key) => [key, rng.nextInt(1, 20)]),
  ) as VisibleAttributes
}

/** A random roster of 5–13 players with random ratings, heights and Consistency. */
function randomTeam(rng: Rng, id: string): MatchTeam {
  const size = rng.nextInt(5, 13)
  const roster = Array.from({ length: size }, (_, i) =>
    makePlayer({
      id: `${id}${i}`,
      attributes: randomAttributes(rng),
      heightCm: rng.nextInt(175, 230),
      consistency: rng.nextInt(1, 20),
    }),
  )
  return { id, name: `Fuzz ${id}`, roster }
}

/** A random but legal rule set, based on pro or FIBA rules. */
function randomRules(rng: Rng): LeagueRules {
  const base = rng.chance(0.5) ? PRO_RULES : FIBA_RULES
  return {
    ...base,
    periods: rng.pick([2, 4]),
    periodSeconds: rng.nextInt(5, 20) * 60,
    overtimeSeconds: rng.nextInt(2, 5) * 60,
    personalFoulLimit: rng.nextInt(2, 6),
  }
}

describe('fuzzed rosters and rules', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it(`always produce a valid game (${FUZZ_GAMES} random games)`, () => {
    for (let i = 0; i < FUZZ_GAMES; i++) {
      const rng = createRng(777_000 + i)
      const rules = randomRules(rng)
      const result = simulateGame({
        home: randomTeam(rng, 'H'),
        away: randomTeam(rng, 'A'),
        rules,
        seed: i,
      })
      expectValidResult(result, rules)
    }
  })
})
