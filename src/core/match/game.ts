import { createRng } from '../shared/rng.ts'
import type { LeagueRules } from '../world/rules.ts'
import { simulatePossession } from './possession.ts'
import type { GameState, TeamState } from './state.ts'
import { createTeamState, log } from './state.ts'
import type { MatchResult, MatchTeam, TeamResult } from './types.ts'

/** Everything needed to simulate one game. */
export interface SimulateGameOptions {
  home: MatchTeam
  away: MatchTeam
  rules: LeagueRules
  /** Same seed + same teams + same rules = the exact same game, every time. */
  seed: number
}

/** Which team starts a period with the ball, following the alternating-possession rule. */
export function periodStarter(game: GameState, tipWinner: TeamState): TeamState {
  const tipLoser = tipWinner === game.home ? game.away : game.home
  // Pro rule: the tip winner starts Q1 and Q4; the other team starts Q2 and Q3.
  // Overtime periods start with a new jump ball, handled by the caller.
  return game.period === 2 || game.period === 3 ? tipLoser : tipWinner
}

/** Simulates one period, alternating possessions until the clock hits zero. */
function playPeriod(game: GameState, lengthSeconds: number, starter: TeamState): void {
  game.clock = lengthSeconds
  game.home.periodPoints[game.period - 1] ??= 0
  game.away.periodPoints[game.period - 1] ??= 0
  let offense = starter
  while (game.clock > 0) {
    const defense = offense === game.home ? game.away : game.home
    simulatePossession(game, offense, defense)
    offense = defense
  }
  log(game, starter, `End of ${periodName(game)}`)
}

/** Name of the current period for play-by-play, e.g. "Q3" or "OT2". */
export function periodName(game: GameState): string {
  const overtime = game.period - game.rules.periods
  if (overtime <= 0) return `Q${game.period}`
  return overtime === 1 ? 'OT' : `OT${overtime}`
}

/** Converts a team's live state into its final, plain-data result. */
function toTeamResult(team: TeamState): TeamResult {
  return {
    teamId: team.team.id,
    name: team.team.name,
    points: team.points,
    periodPoints: team.periodPoints,
    possessions: team.possessions,
    shotsByPlayType: team.shotsByPlayType,
    players: team.team.roster.map((p) => team.lines.get(p.id)).filter((l) => l !== undefined),
  }
}

/** Simulates a full game, including overtime until there's a winner. */
export function simulateGame(options: SimulateGameOptions): MatchResult {
  const rng = createRng(options.seed)
  const game: GameState = {
    rng,
    rules: options.rules,
    home: createTeamState(rng, options.home, true),
    away: createTeamState(rng, options.away, false),
    period: 1,
    clock: 0,
    playByPlay: [],
  }

  const tipWinner = rng.chance(0.5) ? game.home : game.away
  for (game.period = 1; game.period <= options.rules.periods; game.period++) {
    playPeriod(game, options.rules.periodSeconds, periodStarter(game, tipWinner))
  }
  // Basketball can't end in a tie: keep playing overtime periods, each starting with a jump ball.
  while (game.home.points === game.away.points) {
    playPeriod(game, options.rules.overtimeSeconds, rng.chance(0.5) ? game.home : game.away)
    game.period++
  }

  return {
    home: toTeamResult(game.home),
    away: toTeamResult(game.away),
    periodsPlayed: game.period - 1,
    playByPlay: game.playByPlay,
  }
}
