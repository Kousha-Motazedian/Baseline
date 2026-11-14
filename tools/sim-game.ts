/**
 * Simulates one game between two randomly generated average teams and prints the box score
 * and the end of the play-by-play.
 *
 *   npm run sim:game            random seed
 *   npm run sim:game -- 1234    reproducible game from seed 1234
 */
import { generateLeague } from '../src/core/data/teamGenerator.ts'
import { simulateGame } from '../src/core/match/game.ts'
import type {
  MatchResult,
  MatchTeam,
  PlayByPlayEntry,
  PlayerLine,
  TeamResult,
} from '../src/core/match/types.ts'
import { createRng } from '../src/core/shared/rng.ts'
import { PRO_RULES } from '../src/core/world/rules.ts'

/** How many play-by-play lines to show from the end of the game. */
const PLAY_BY_PLAY_LINES = 25

/** Formats seconds as m:ss. */
function clock(seconds: number): string {
  const whole = Math.ceil(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Formats made-attempted, e.g. "7-15". */
function madeOf(made: number, attempted: number): string {
  return `${made}-${attempted}`
}

/** Formats one player's box score row. */
function playerRow(line: PlayerLine): string {
  const cells = [
    line.name.padEnd(22),
    clock(line.secondsPlayed).padStart(6),
    String(line.points).padStart(4),
    madeOf(line.fieldGoalsMade, line.fieldGoalsAttempted).padStart(7),
    madeOf(line.threesMade, line.threesAttempted).padStart(7),
    madeOf(line.freeThrowsMade, line.freeThrowsAttempted).padStart(7),
    String(line.offensiveRebounds + line.defensiveRebounds).padStart(4),
    String(line.assists).padStart(4),
    String(line.steals).padStart(4),
    String(line.blocks).padStart(4),
    String(line.turnovers).padStart(4),
    String(line.personalFouls).padStart(4),
  ]
  return cells.join(' ')
}

/** Sums a numeric field over a team's player lines. */
function total(team: TeamResult, field: keyof PlayerLine): number {
  return team.players.reduce((sum, line) => sum + Number(line[field]), 0)
}

/** Builds a pseudo player line holding the team totals, so it prints with the same layout. */
function totalsLine(team: TeamResult): PlayerLine {
  /** Team total of one box score field. */
  const sum = (field: keyof PlayerLine): number => total(team, field)
  return {
    playerId: 'total',
    name: 'TEAM',
    secondsPlayed: sum('secondsPlayed'),
    points: team.points,
    fieldGoalsMade: sum('fieldGoalsMade'),
    fieldGoalsAttempted: sum('fieldGoalsAttempted'),
    threesMade: sum('threesMade'),
    threesAttempted: sum('threesAttempted'),
    freeThrowsMade: sum('freeThrowsMade'),
    freeThrowsAttempted: sum('freeThrowsAttempted'),
    offensiveRebounds: sum('offensiveRebounds'),
    defensiveRebounds: sum('defensiveRebounds'),
    assists: sum('assists'),
    steals: sum('steals'),
    blocks: sum('blocks'),
    turnovers: sum('turnovers'),
    personalFouls: sum('personalFouls'),
    technicalFouls: sum('technicalFouls'),
  }
}

/** Prints one team's box score. */
function printBoxScore(team: TeamResult): void {
  const header = ['Player'.padEnd(22), 'MIN'.padStart(6), 'PTS'.padStart(4), 'FG'.padStart(7)]
  header.push('3PT'.padStart(7), 'FT'.padStart(7), 'REB'.padStart(4), 'AST'.padStart(4))
  header.push('STL'.padStart(4), 'BLK'.padStart(4), 'TO'.padStart(4), 'PF'.padStart(4))
  console.log(`\n${team.name} — ${team.points}`)
  console.log(header.join(' '))
  for (const line of team.players) console.log(playerRow(line))
  console.log(playerRow(totalsLine(team)))
  console.log(
    `Possessions: ${team.possessions}  Fast-break pts: ${team.fastBreakPoints}  ` +
      `Pts off TO: ${team.pointsOffTurnovers}  Technicals: ${total(team, 'technicalFouls')}`,
  )
}

/** Prints the score by period, e.g. "Q1 Q2 Q3 Q4 OT". */
function printLineScore(result: MatchResult): void {
  const periods = result.home.periodPoints.map((_, i) =>
    i < PRO_RULES.periods ? `Q${i + 1}` : `OT${i - PRO_RULES.periods + 1}`,
  )
  /** One team's line: name, points by period, final score. */
  const row = (team: TeamResult): string =>
    team.name.padEnd(24) +
    team.periodPoints.map((p) => String(p).padStart(5)).join('') +
    String(team.points).padStart(6)
  console.log(`\n${''.padEnd(24)}${periods.map((p) => p.padStart(5)).join('')}${'T'.padStart(6)}`)
  console.log(row(result.away))
  console.log(row(result.home))
}

/** Formats one play-by-play entry. */
function playRow(entry: PlayByPlayEntry, result: MatchResult): string {
  const team = entry.teamId === result.home.teamId ? result.home.name : result.away.name
  const score = `${entry.awayScore}-${entry.homeScore}`
  return `P${entry.period} ${clock(entry.clockSeconds).padStart(5)}  ${score.padStart(7)}  ${team.padEnd(22)} ${entry.text}`
}

/** Entry point: generates two teams from the seed, simulates the game, prints the report. */
function main(): void {
  const arg = process.argv[2]
  // A seed from the command line makes the game reproducible; otherwise pick one from the time.
  const seed = arg === undefined ? Date.now() % 1_000_000 : Number(arg)
  if (!Number.isFinite(seed)) throw new Error(`Seed must be a number, got "${arg}"`)

  const rng = createRng(seed)
  const [away, home] = generateLeague(rng, 2) as [MatchTeam, MatchTeam]
  const result = simulateGame({ home, away, rules: PRO_RULES, seed })

  console.log(`Seed ${seed}: ${away.name} at ${home.name}`)
  printLineScore(result)
  printBoxScore(result.away)
  printBoxScore(result.home)
  console.log(`\nLast ${PLAY_BY_PLAY_LINES} plays (score shown away-home):`)
  for (const entry of result.playByPlay.slice(-PLAY_BY_PLAY_LINES))
    console.log(playRow(entry, result))
}

main()
