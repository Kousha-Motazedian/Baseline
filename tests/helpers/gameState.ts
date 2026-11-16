/**
 * Builds a live GameState outside of simulateGame, so individual engine steps (shots, fouls,
 * rebounds, clutch checks) can be unit-tested with exact inputs.
 */
import type { GameState } from '../../src/core/match/state.ts'
import { createTeamState } from '../../src/core/match/state.ts'
import type { MatchTeam } from '../../src/core/match/types.ts'
import { buildRotationPlan } from '../../src/core/tactics/rotation.ts'
import { BALANCED_SYSTEM } from '../../src/core/tactics/system.ts'
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
  /**
   * Overrides every player's rolled form, offense and defense alike (e.g. 0 to remove form noise
   * from a unit test).
   */
  form?: number
}

/**
 * The team with its first five roster players as starters (slot i = roster index i), so a unit
 * test can build its lineup from roster positions. The real coach picks starters by value and
 * position, which would make "roster[2] is the C" style fixtures unreliable; a team that already
 * carries a `rotation` keeps it.
 */
export function withRosterStarters(team: MatchTeam): MatchTeam {
  if (team.rotation) return team
  const ids = team.roster.map((p) => p.id)
  const targetSeconds = Object.fromEntries(ids.map((id, i) => [id, i < 5 ? 1920 : i < 9 ? 480 : 0]))
  const rotation = buildRotationPlan(
    team.roster,
    undefined,
    team.coaching?.system ?? BALANCED_SYSTEM,
    { starters: ids.slice(0, 5), order: ids, targetSeconds },
  )
  return { ...team, rotation }
}

/** Creates a game state at a chosen moment of a game, with optional fixed form for everyone. */
export function makeGameState(options: TestGameOptions): GameState {
  const rng = createRng(options.seed ?? 1)
  const rules = options.rules ?? PRO_RULES
  const game: GameState = {
    rng,
    rules,
    home: createTeamState(rng, withRosterStarters(options.home), true, rules),
    away: createTeamState(rng, withRosterStarters(options.away), false, rules),
    period: options.period ?? 1,
    clock: options.clock ?? 720,
    playByPlay: [],
  }
  if (options.form !== undefined) {
    for (const team of [game.home, game.away]) {
      for (const id of team.form.keys()) {
        team.form.set(id, { offense: options.form, defense: options.form })
      }
    }
  }
  return game
}
