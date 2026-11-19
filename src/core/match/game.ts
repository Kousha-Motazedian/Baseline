import { createRng } from '../shared/rng.ts'
import type { LeagueRules } from '../world/rules.ts'
import type { PossessionStart } from './possession.ts'
import { HALF_COURT_START, simulatePossession } from './possession.ts'
import { applyBreakRecovery } from './fatigue.ts'
import type { GameState, TeamState } from './state.ts'
import { createTeamState, log, opponentOf } from './state.ts'
import { applyBothSubstitutions } from './substitutions.ts'
import { resetTeamFouls } from './teamFouls.ts'
import type { MatchResult, MatchTeam, TeamResult } from './types.ts'

/** Everything needed to simulate one game. */
export interface SimulateGameOptions {
  home: MatchTeam
  away: MatchTeam
  rules: LeagueRules
  /** Same seed + same teams + same rules = the exact same game, every time. */
  seed: number
}

/** A jump ball: either team wins it with equal chance. */
function jumpBall(game: GameState): TeamState {
  return game.rng.chance(0.5) ? game.home : game.away
}

/**
 * Which team starts the current period with the ball, given who won the opening tip. The
 * league's periodStartRule decides (see rules.ts).
 */
export function periodStarter(game: GameState, tipWinner: TeamState): TeamState {
  const tipLoser = opponentOf(game, tipWinner)
  if (game.period === 1) return tipWinner
  if (game.rules.periodStartRule === 'alternatingArrow') {
    // The arrow first points to the tip loser (period 2), then flips every period, overtimes
    // included: tip loser in even periods, tip winner in odd ones. No held balls are modelled
    // during play, so nothing else flips it.
    return game.period % 2 === 0 ? tipLoser : tipWinner
  }
  // Pro: every overtime starts with a new jump ball.
  if (game.period > game.rules.periods) return jumpBall(game)
  // Pro: the tip loser starts the 2nd and 3rd quarters, the tip winner the 4th.
  return game.period === 2 || game.period === 3 ? tipLoser : tipWinner
}

/**
 * Simulates one period, alternating possessions until the clock hits zero. How each possession
 * ended (a turnover, a fast-break chance) carries into how the next one starts.
 */
function playPeriod(game: GameState, lengthSeconds: number, starter: TeamState): void {
  game.clock = lengthSeconds
  game.home.periodPoints[game.period - 1] ??= 0
  game.away.periodPoints[game.period - 1] ??= 0
  resetTeamFouls(game)
  // Players rest during the break before this period (more at halftime).
  applyBreakRecovery(game)
  let offense = starter
  let start: PossessionStart = HALF_COURT_START
  while (game.clock > 0) {
    // Every possession starts at a dead ball: the coaches may substitute.
    applyBothSubstitutions(game)
    const defense = offense === game.home ? game.away : game.home
    const end = simulatePossession(game, offense, defense, start)
    start = { fastBreak: end.fastBreak, afterTurnover: end.turnover }
    offense = defense
  }
  // Not a team action; by convention it's attributed to the team that started the period.
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
    fastBreakPoints: team.fastBreakPoints,
    pointsOffTurnovers: team.pointsOffTurnovers,
    teamRebounds: team.teamRebounds,
    exhaustedSeconds: team.exhaustedSeconds,
    players: team.team.roster.map((p) => team.lines.get(p.id)).filter((l) => l !== undefined),
  }
}

/** Simulates a full game, including overtime until there's a winner. */
export function simulateGame(options: SimulateGameOptions): MatchResult {
  const rng = createRng(options.seed)
  const game: GameState = {
    rng,
    rules: options.rules,
    home: createTeamState(rng, options.home, true, options.rules),
    away: createTeamState(rng, options.away, false, options.rules),
    period: 1,
    clock: 0,
    playByPlay: [],
  }

  const tipWinner = jumpBall(game)
  for (game.period = 1; game.period <= options.rules.periods; game.period++) {
    playPeriod(game, options.rules.periodSeconds, periodStarter(game, tipWinner))
  }
  // Basketball can't end in a tie: keep playing overtime periods until there's a winner.
  while (game.home.points === game.away.points) {
    playPeriod(game, options.rules.overtimeSeconds, periodStarter(game, tipWinner))
    game.period++
  }

  return {
    home: toTeamResult(game.home),
    away: toTeamResult(game.away),
    periodsPlayed: game.period - 1,
    playByPlay: game.playByPlay,
  }
}
