/**
 * Builds a live GameState outside of simulateGame, so individual engine steps (shots, fouls,
 * rebounds, clutch checks) can be unit-tested with exact inputs.
 */
import type { GameState } from '../../src/core/match/state.ts'
import { createTeamState } from '../../src/core/match/state.ts'
import type { MatchTeam } from '../../src/core/match/types.ts'
import { createRng } from '../../src/core/shared/rng.ts'
import type { LeagueRules } from '../../src/core/world/rules.ts'
import { PRO_RULES } from '../../src/core/world/rules.ts'

/** Options for a hand-built game state. */
export interface TestGameOptions {
  home: MatchTeam
  away: MatchTeam
  rules?: LeagueRules
  seed?: number
  period?: number
  clock?: number
  /** Overrides every player's rolled form (e.g. 0 to remove form noise from a unit test). */
  form?: number
}

/** Creates a game state at a chosen moment of a game, with optional fixed form for everyone. */
export function makeGameState(options: TestGameOptions): GameState {
  const rng = createRng(options.seed ?? 1)
  const game: GameState = {
    rng,
    rules: options.rules ?? PRO_RULES,
    home: createTeamState(rng, options.home, true),
    away: createTeamState(rng, options.away, false),
    period: options.period ?? 1,
    clock: options.clock ?? 720,
    playByPlay: [],
  }
  if (options.form !== undefined) {
    for (const team of [game.home, game.away]) {
      for (const id of team.form.keys()) team.form.set(id, options.form)
    }
  }
  return game
}
