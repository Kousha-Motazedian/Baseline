/**
 * Batch simulator for calibration and balance checks.
 *
 *   npm run sim:batch                      2,000 games between generated average teams
 *   npm run sim:batch -- --games 5000      more games (tighter averages)
 *   npm run sim:batch -- --seed 42         different random league
 *   npm run sim:batch -- --balance         also run the offense-vs-defense balance tests
 */
import { generateTeam } from '../src/core/data/teamGenerator.ts'
import { simulateGame } from '../src/core/match/game.ts'
import type { MatchResult, MatchTeam, PlayType, TeamResult } from '../src/core/match/types.ts'
import { PLAY_TYPES } from '../src/core/match/types.ts'
import type { VisibleAttributeKey } from '../src/core/players/attributes.ts'
import {
  DEFENSIVE_ATTRIBUTE_KEYS,
  OFFENSIVE_ATTRIBUTE_KEYS,
  VISIBLE_ATTRIBUTE_KEYS,
} from '../src/core/players/attributes.ts'
import { createRng } from '../src/core/shared/rng.ts'
import { PRO_RULES } from '../src/core/world/rules.ts'

/** Sums of every counting stat across many team-games. */
interface Totals {
  teamGames: number
  games: number
  overtimeGames: number
  minutes: number
  possessions: number
  points: number
  fga: number
  fgm: number
  tpa: number
  tpm: number
  fta: number
  ftm: number
  turnovers: number
  offensiveRebounds: number
  opponentDefensiveRebounds: number
  assists: number
  blocks: number
  steals: number
  playTypeAttempts: Record<PlayType, number>
  playTypeMakes: Record<PlayType, number>
}

/** Creates an all-zero totals object. */
function emptyTotals(): Totals {
  const zeroByPlay = (): Record<PlayType, number> =>
    Object.fromEntries(PLAY_TYPES.map((t) => [t, 0])) as Record<PlayType, number>
  return {
    teamGames: 0,
    games: 0,
    overtimeGames: 0,
    minutes: 0,
    possessions: 0,
    points: 0,
    fga: 0,
    fgm: 0,
    tpa: 0,
    tpm: 0,
    fta: 0,
    ftm: 0,
    turnovers: 0,
    offensiveRebounds: 0,
    opponentDefensiveRebounds: 0,
    assists: 0,
    blocks: 0,
    steals: 0,
    playTypeAttempts: zeroByPlay(),
    playTypeMakes: zeroByPlay(),
  }
}

/** Sums one numeric field over a team's player lines. */
function sumLines(team: TeamResult, field: keyof TeamResult['players'][number]): number {
  return team.players.reduce((sum, line) => sum + Number(line[field]), 0)
}

/** Adds one team's game to the totals (the opponent is needed for ORB%). */
function addTeamGame(
  totals: Totals,
  team: TeamResult,
  opponent: TeamResult,
  minutes: number,
): void {
  totals.teamGames += 1
  totals.minutes += minutes
  totals.possessions += team.possessions
  totals.points += team.points
  totals.fga += sumLines(team, 'fieldGoalsAttempted')
  totals.fgm += sumLines(team, 'fieldGoalsMade')
  totals.tpa += sumLines(team, 'threesAttempted')
  totals.tpm += sumLines(team, 'threesMade')
  totals.fta += sumLines(team, 'freeThrowsAttempted')
  totals.ftm += sumLines(team, 'freeThrowsMade')
  totals.turnovers += sumLines(team, 'turnovers')
  totals.offensiveRebounds += sumLines(team, 'offensiveRebounds')
  totals.opponentDefensiveRebounds += sumLines(opponent, 'defensiveRebounds')
  totals.assists += sumLines(team, 'assists')
  totals.blocks += sumLines(team, 'blocks')
  totals.steals += sumLines(team, 'steals')
  for (const type of PLAY_TYPES) {
    totals.playTypeAttempts[type] += team.shotsByPlayType[type].attempted
    totals.playTypeMakes[type] += team.shotsByPlayType[type].made
  }
}

/** Game length in minutes, including overtime. */
function gameMinutes(result: MatchResult): number {
  const overtimes = result.periodsPlayed - PRO_RULES.periods
  return (PRO_RULES.periods * PRO_RULES.periodSeconds + overtimes * PRO_RULES.overtimeSeconds) / 60
}

/** Adds both teams of a finished game to the totals. */
function addGame(totals: Totals, result: MatchResult): void {
  const minutes = gameMinutes(result)
  totals.games += 1
  if (result.periodsPlayed > PRO_RULES.periods) totals.overtimeGames += 1
  addTeamGame(totals, result.home, result.away, minutes)
  addTeamGame(totals, result.away, result.home, minutes)
}

/** One league-average stat with its real-world target range. */
interface Metric {
  label: string
  value: number
  min: number
  max: number
  digits: number
}

/** Computes every calibration metric from the totals, with the real modern pro-league targets. */
function metrics(t: Totals): Metric[] {
  const per100 = (n: number): number => (n / t.possessions) * 100
  return [
    {
      label: 'Possessions / team / 48 min',
      value: (t.possessions / t.minutes) * 48,
      min: 97,
      max: 101,
      digits: 1,
    },
    { label: 'Points / team-game', value: t.points / t.teamGames, min: 112, max: 116, digits: 1 },
    { label: 'Offensive rating (pts/100)', value: per100(t.points), min: 113, max: 117, digits: 1 },
    { label: 'FG%', value: t.fgm / t.fga, min: 0.46, max: 0.48, digits: 3 },
    { label: '3PA / FGA', value: t.tpa / t.fga, min: 0.38, max: 0.42, digits: 3 },
    { label: '3P%', value: t.tpm / t.tpa, min: 0.35, max: 0.37, digits: 3 },
    { label: 'FTA / FGA', value: t.fta / t.fga, min: 0.22, max: 0.27, digits: 3 },
    { label: 'FT%', value: t.ftm / t.fta, min: 0.77, max: 0.79, digits: 3 },
    { label: 'Turnovers / 100 poss', value: per100(t.turnovers), min: 12, max: 14, digits: 1 },
    {
      label: 'ORB%',
      value: t.offensiveRebounds / (t.offensiveRebounds + t.opponentDefensiveRebounds),
      min: 0.23,
      max: 0.27,
      digits: 3,
    },
    { label: 'Assists / FGM', value: t.assists / t.fgm, min: 0.58, max: 0.64, digits: 3 },
    { label: 'Blocks / team-game', value: t.blocks / t.teamGames, min: 4.5, max: 5.5, digits: 2 },
    { label: 'Steals / team-game', value: t.steals / t.teamGames, min: 7, max: 8, digits: 2 },
    {
      label: 'Overtime rate (games)',
      value: t.overtimeGames / t.games,
      min: 0.05,
      max: 0.07,
      digits: 3,
    },
  ]
}

/** Formats one metric as a table row with a PASS / OFF marker. */
function metricRow(m: Metric): string {
  const ok = m.value >= m.min && m.value <= m.max
  const target = `${m.min.toFixed(m.digits)}–${m.max.toFixed(m.digits)}`
  return `${m.label.padEnd(30)} ${m.value.toFixed(m.digits).padStart(8)}   ${target.padEnd(14)} ${ok ? 'PASS' : 'OFF'}`
}

/** Prints the league averages vs targets and the shot mix by play type. */
function printReport(t: Totals): void {
  console.log(`\n${t.games} games, ${t.teamGames} team-games\n`)
  console.log(`${'Metric'.padEnd(30)} ${'Sim'.padStart(8)}   ${'Target'.padEnd(14)} Result`)
  console.log('-'.repeat(64))
  for (const m of metrics(t)) console.log(metricRow(m))

  console.log(`\n${'Play type'.padEnd(12)} ${'Share of FGA'.padStart(12)} ${'FG%'.padStart(7)}`)
  for (const type of PLAY_TYPES) {
    const attempts = t.playTypeAttempts[type]
    const share = ((attempts / t.fga) * 100).toFixed(1) + '%'
    const pct = (t.playTypeMakes[type] / attempts).toFixed(3)
    console.log(`${type.padEnd(12)} ${share.padStart(12)} ${pct.padStart(7)}`)
  }
}

/** Generates the two average teams for game `index` of a league seeded with `seed`. */
function averageTeams(seed: number, index: number): [MatchTeam, MatchTeam] {
  const rng = createRng(seed * 100_003 + index)
  return [generateTeam(rng, { id: 'A' }), generateTeam(rng, { id: 'B' })]
}

/**
 * Returns a copy of a team with `amount` added to the listed attributes of every player.
 * Not clamped at 20 on purpose: the test measures how the engine responds to a pure +3 shift,
 * and the engine handles ratings above 20 smoothly.
 */
function boostTeam(
  team: MatchTeam,
  keys: readonly VisibleAttributeKey[],
  amount: number,
): MatchTeam {
  const roster = team.roster.map((player) => {
    const attributes = { ...player.attributes }
    for (const key of keys) attributes[key] += amount
    return { ...player, attributes }
  })
  return { ...team, roster }
}

/** Simulates `team` vs `opponent` with home court alternating by game index. */
function play(team: MatchTeam, opponent: MatchTeam, index: number, seed: number): MatchResult {
  const teamIsHome = index % 2 === 0
  return simulateGame({
    home: teamIsHome ? team : opponent,
    away: teamIsHome ? opponent : team,
    rules: PRO_RULES,
    seed: seed * 7_919 + index,
  })
}

/** Simulates the calibration league: `games` games between freshly generated average teams. */
function runLeague(games: number, seed: number): Totals {
  const totals = emptyTotals()
  for (let i = 0; i < games; i++) {
    const [a, b] = averageTeams(seed, i)
    addGame(totals, play(a, b, i, seed))
  }
  return totals
}

/** Running point and possession totals for one side of a matchup across many games. */
interface NetTally {
  pointsFor: number
  pointsAgainst: number
  possessions: number
}

/** Team A's result in a game, regardless of whether A was home or away. */
function sideOf(result: MatchResult, teamId: string): [TeamResult, TeamResult] {
  return result.home.teamId === teamId ? [result.home, result.away] : [result.away, result.home]
}

/** Adds team A's points for/against and the game's possessions to a net-rating tally. */
function addNet(tally: NetTally, result: MatchResult): void {
  const [us, them] = sideOf(result, 'A')
  tally.pointsFor += us.points
  tally.pointsAgainst += them.points
  tally.possessions += (us.possessions + them.possessions) / 2
}

/** Net rating (points scored minus allowed per 100 possessions). */
function netRating(t: NetTally): number {
  return ((t.pointsFor - t.pointsAgainst) / t.possessions) * 100
}

/** Offensive rating (points per 100 possessions) of team A. */
function offensiveRating(t: NetTally): number {
  return (t.pointsFor / t.possessions) * 100
}

/** Creates an empty net-rating tally. */
function emptyNet(): NetTally {
  return { pointsFor: 0, pointsAgainst: 0, possessions: 0 }
}

/**
 * Balance tests. Each generated average team A is played against average team B four ways,
 * with the same game seed (paired comparison, which cancels most of the random noise):
 *   base:       A vs B
 *   offense+3:  A with +3 on every offensive attribute vs B
 *   defense+3:  A with +3 on every defensive attribute vs B
 *   league+3:   A and B both +3 on every attribute (league-level invariance)
 */
function runBalance(games: number, seed: number): void {
  const base = emptyNet()
  const offense = emptyNet()
  const defense = emptyNet()
  const leagueBase = emptyNet()
  const leagueBoosted = emptyNet()
  for (let i = 0; i < games; i++) {
    const [a, b] = averageTeams(seed, i)
    const baseResult = play(a, b, i, seed)
    addNet(base, baseResult)
    addNet(leagueBase, baseResult)
    addNet(offense, play(boostTeam(a, OFFENSIVE_ATTRIBUTE_KEYS, 3), b, i, seed))
    addNet(defense, play(boostTeam(a, DEFENSIVE_ATTRIBUTE_KEYS, 3), b, i, seed))
    const allA = boostTeam(a, VISIBLE_ATTRIBUTE_KEYS, 3)
    const allB = boostTeam(b, VISIBLE_ATTRIBUTE_KEYS, 3)
    addNet(leagueBoosted, play(allA, allB, i, seed))
  }
  printBalance(base, offense, defense, leagueBase, leagueBoosted, games)
}

/** Prints the balance-test results with PASS / OFF markers. */
function printBalance(
  base: NetTally,
  offense: NetTally,
  defense: NetTally,
  leagueBase: NetTally,
  leagueBoosted: NetTally,
  games: number,
): void {
  const offenseGain = netRating(offense) - netRating(base)
  const defenseGain = netRating(defense) - netRating(base)
  const ratio = offenseGain / defenseGain
  // League scoring compares both teams' points (A's offensive rating plus B's, averaged).
  const leagueRating = (t: NetTally): number =>
    ((t.pointsFor + t.pointsAgainst) / 2 / t.possessions) * 100
  const leagueShift = leagueRating(leagueBoosted) - leagueRating(leagueBase)

  console.log(`\nBalance tests (${games} paired games each)`)
  console.log('-'.repeat(64))
  console.log(`+3 offense: net rating gain ${offenseGain.toFixed(2)} per 100 poss`)
  console.log(
    `  (ORtg ${offensiveRating(base).toFixed(1)} -> ${offensiveRating(offense).toFixed(1)})`,
  )
  console.log(`+3 defense: net rating gain ${defenseGain.toFixed(2)} per 100 poss`)
  console.log(
    `Offense : defense ratio      ${ratio.toFixed(2)} : 1   target 1.30–1.50   ${ratio >= 1.3 && ratio <= 1.5 ? 'PASS' : 'OFF'}`,
  )
  console.log(
    `League +3 everywhere: ${leagueRating(leagueBase).toFixed(1)} -> ${leagueRating(leagueBoosted).toFixed(1)} pts/100 ` +
      `(shift ${leagueShift >= 0 ? '+' : ''}${leagueShift.toFixed(2)}, target within ±2)   ${Math.abs(leagueShift) <= 2 ? 'PASS' : 'OFF'}`,
  )
}

/** Reads a numeric `--name value` command-line option, or returns the fallback. */
function numberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isFinite(value)) throw new Error(`--${name} needs a number`)
  return value
}

/** Entry point: runs the calibration league and, with --balance, the balance tests. */
function main(): void {
  const games = numberArg('games', 2000)
  const seed = numberArg('seed', 1)
  const started = Date.now()
  printReport(runLeague(games, seed))
  if (process.argv.includes('--balance')) runBalance(numberArg('balance-games', games), seed)
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)} s`)
}

main()
