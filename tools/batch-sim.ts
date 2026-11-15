/**
 * Batch simulator for calibration and balance checks.
 *
 *   npm run sim:batch                      2,000 games between generated league teams
 *   npm run sim:batch -- --games 5000      more games (tighter averages)
 *   npm run sim:batch -- --seed 42         different random league
 *   npm run sim:batch -- --balance         also run the offense-vs-defense balance tests
 *   npm run sim:batch -- --average         uniform average teams (no stars) instead of league teams
 *   npm run sim:batch -- --league-systems  every league team runs a random archetype system
 *   npm run sim:batch -- --systems         report-only system/fit/coaching experiments
 *   npm run sim:batch -- --fit-stats       raw fit mean/SD per system option (fit centering data)
 *
 * Besides the league games, it plays the same number of games between identical teams (a team
 * against a copy of itself) to measure randomness: final-margin spread, overtime rate, home edge.
 */
import { AVERAGE_TEAM_CA, generateTeam } from '../src/core/data/teamGenerator.ts'
import { simulateGame } from '../src/core/match/game.ts'
import type {
  MatchResult,
  MatchTeam,
  PlayType,
  TeamCoaching,
  TeamResult,
} from '../src/core/match/types.ts'
import { PLAY_TYPES } from '../src/core/match/types.ts'
import type { VisibleAttributeKey } from '../src/core/players/attributes.ts'
import {
  DEFENSIVE_ATTRIBUTE_KEYS,
  OFFENSIVE_ATTRIBUTE_KEYS,
  VISIBLE_ATTRIBUTE_KEYS,
} from '../src/core/players/attributes.ts'
import type { Rng } from '../src/core/shared/rng.ts'
import { createRng } from '../src/core/shared/rng.ts'
import { PRO_RULES } from '../src/core/world/rules.ts'
import type { HeadCoach } from '../src/core/staff/types.ts'
import { coachingInputs } from '../src/core/tactics/coaching.ts'
import type { FitDemand } from '../src/core/tactics/fit.ts'
import { FIT_DEMANDS, fitBasis, lineupFit, rawFit } from '../src/core/tactics/fit.ts'
import type { SystemSetting, TeamSystem } from '../src/core/tactics/system.ts'
import {
  archetypeSystem,
  BALANCED_SYSTEM,
  generateSystem,
  SETTING_OPTIONS,
  SYSTEM_ARCHETYPES,
} from '../src/core/tactics/system.ts'
import { EXECUTION_EDGE, FIT_EDGE } from '../src/core/tactics/tuning.ts'

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
  personalFouls: number
  technicalFouls: number
  /** Players who reached the personal-foul limit (both teams). */
  foulOuts: number
  /** Team-games scoring under 70 points. */
  under70: number
  fastBreakPoints: number
  pointsOffTurnovers: number
  /** Sum over team-games of the team's top scorer's points. */
  topScorerPoints: number
  /** Games in which some player scored 40+ (and 50+). */
  games40: number
  games50: number
  playTypeAttempts: Record<PlayType, number>
  playTypeMakes: Record<PlayType, number>
}

/** Creates an all-zero totals object. */
function emptyTotals(): Totals {
  /** A zero for every play type. */
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
    personalFouls: 0,
    technicalFouls: 0,
    foulOuts: 0,
    under70: 0,
    fastBreakPoints: 0,
    pointsOffTurnovers: 0,
    topScorerPoints: 0,
    games40: 0,
    games50: 0,
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
  totals.personalFouls += sumLines(team, 'personalFouls')
  totals.technicalFouls += sumLines(team, 'technicalFouls')
  if (team.points < 70) totals.under70 += 1
  totals.foulOuts += team.players.filter(
    (line) => line.personalFouls >= PRO_RULES.personalFoulLimit,
  ).length
  totals.fastBreakPoints += team.fastBreakPoints
  totals.pointsOffTurnovers += team.pointsOffTurnovers
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

/** Points of a team's top scorer in one game. */
function topScore(team: TeamResult): number {
  return Math.max(0, ...team.players.map((line) => line.points))
}

/** Adds the individual-scoring watch numbers (top scorers, 40+ and 50+ games) for one game. */
function addTopScorers(totals: Totals, result: MatchResult): void {
  const home = topScore(result.home)
  const away = topScore(result.away)
  totals.topScorerPoints += home + away
  if (Math.max(home, away) >= 40) totals.games40 += 1
  if (Math.max(home, away) >= 50) totals.games50 += 1
}

/** Adds both teams of a finished game to the totals. */
function addGame(totals: Totals, result: MatchResult): void {
  const minutes = gameMinutes(result)
  totals.games += 1
  if (result.periodsPlayed > PRO_RULES.periods) totals.overtimeGames += 1
  addTeamGame(totals, result.home, result.away, minutes)
  addTeamGame(totals, result.away, result.home, minutes)
  addTopScorers(totals, result)
}

/** One league-average stat with its real-world target range (no range = reported only). */
interface Metric {
  label: string
  value: number
  min?: number
  max?: number
  digits: number
}

/** Computes every calibration metric from the totals, with the real modern pro-league targets. */
function metrics(t: Totals): Metric[] {
  /** Scales a league total to a rate per 100 possessions. */
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
      label: 'Personal fouls / team-game',
      value: t.personalFouls / t.teamGames,
      min: 19,
      max: 21,
      digits: 1,
    },
    {
      label: 'Technicals / team-game',
      value: t.technicalFouls / t.teamGames,
      min: 0.4,
      max: 0.8,
      digits: 2,
    },
    {
      label: 'Foul-outs / game',
      value: t.foulOuts / t.games,
      min: 0.1,
      max: 0.3,
      digits: 2,
    },
    {
      // Low scores should come from team quality and tactics, never from propping up bad teams:
      // the calibration teams are evenly matched (every league team gets one player from each
      // talent round), so they should be rare here.
      label: 'Team-games under 70 pts',
      value: t.under70 / t.teamGames,
      min: 0,
      max: 0.01,
      digits: 3,
    },
    {
      label: 'Fast-break points / team-game',
      value: t.fastBreakPoints / t.teamGames,
      min: 12,
      max: 16,
      digits: 1,
    },
    {
      label: 'Points off TO / team-game',
      value: t.pointsOffTurnovers / t.teamGames,
      digits: 1,
    },
    {
      label: 'Overtime rate (games)',
      value: t.overtimeGames / t.games,
      min: 0.05,
      max: 0.07,
      digits: 3,
    },
    // Individual box-score watch (report only until rotations exist; see docs/TODO.md). Real
    // modern pro league: team top scorer ≈ 27–28 pts, a 40+ scorer in ≈ 10–16% of games.
    { label: 'Team top scorer (pts)', value: t.topScorerPoints / t.teamGames, digits: 1 },
    { label: 'Games with a 40+ scorer', value: t.games40 / t.games, digits: 3 },
    { label: 'Games with a 50+ scorer', value: t.games50 / t.games, digits: 3 },
  ]
}

/** Formats one metric as a table row with a PASS / OFF marker (or "report" without a target). */
function metricRow(m: Metric): string {
  const value = m.value.toFixed(m.digits).padStart(8)
  if (m.min === undefined || m.max === undefined) {
    return `${m.label.padEnd(30)} ${value}   ${'—'.padEnd(14)} report`
  }
  const ok = m.value >= m.min && m.value <= m.max
  const target = `${m.min.toFixed(m.digits)}–${m.max.toFixed(m.digits)}`
  return `${m.label.padEnd(30)} ${value}   ${target.padEnd(14)} ${ok ? 'PASS' : 'OFF'}`
}

/** Prints the league averages vs targets and the shot mix by play type. */
function printReport(t: Totals): void {
  printMetrics(`${t.games} games, ${t.teamGames} team-games`, metrics(t))

  console.log(`\n${'Play type'.padEnd(12)} ${'Share of FGA'.padStart(12)} ${'FG%'.padStart(7)}`)
  for (const type of PLAY_TYPES) {
    const attempts = t.playTypeAttempts[type]
    const share = ((attempts / t.fga) * 100).toFixed(1) + '%'
    const pct = (t.playTypeMakes[type] / attempts).toFixed(3)
    console.log(`${type.padEnd(12)} ${share.padStart(12)} ${pct.padStart(7)}`)
  }
}

/** Prints a list of metrics under a header. */
function printMetrics(title: string, list: readonly Metric[]): void {
  console.log(`\n${title}`)
  console.log(`${'Metric'.padEnd(30)} ${'Sim'.padStart(8)}   ${'Target'.padEnd(14)} Result`)
  console.log('-'.repeat(64))
  for (const m of list) console.log(metricRow(m))
}

/**
 * Uniform average teams (`--average`) instead of realistic league teams. Set once in main().
 * League teams are the default: they have the stars and depth a real league has. Average teams
 * reproduce the old generator's evenly matched, star-free teams for A/B comparisons.
 */
let useAverageTeams = false

/** Generates one team for the calibration games: a league team, or an average team with --average. */
function calibrationTeam(rng: Rng, id: string): MatchTeam {
  return useAverageTeams
    ? generateTeam(rng, { id, averageCa: AVERAGE_TEAM_CA })
    : generateTeam(rng, { id })
}

/**
 * Every league team runs a random archetype system with an average coach on his own system
 * (`--league-systems`). Set once in main(). Off by default, so the targets check today's engine.
 */
let useLeagueSystems = false

/** A copy of a team running `coaching`. */
function withCoaching(team: MatchTeam, coaching: TeamCoaching): MatchTeam {
  return { ...team, coaching }
}

/** Average coaching (zero execution edges) for a system: an average coach running his own system. */
function averageCoaching(system: TeamSystem): TeamCoaching {
  return { system, offensiveExecution: 0, defensiveExecution: 0 }
}

/**
 * A random archetype system for game `index`, from its own RNG stream so the teams themselves are
 * the same with or without --league-systems.
 */
function randomSystem(seed: number, index: number, side: number): TeamSystem {
  const rng = createRng(seed * 300_007 + index * 2 + side)
  return generateSystem(rng, rng.pick(SYSTEM_ARCHETYPES))
}

/** Generates the two teams for game `index` of a league seeded with `seed`. */
function calibrationPair(seed: number, index: number): [MatchTeam, MatchTeam] {
  const rng = createRng(seed * 100_003 + index)
  const a = calibrationTeam(rng, 'A')
  const b = calibrationTeam(rng, 'B')
  if (!useLeagueSystems) return [a, b]
  return [
    withCoaching(a, averageCoaching(randomSystem(seed, index, 0))),
    withCoaching(b, averageCoaching(randomSystem(seed, index, 1))),
  ]
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

/** Simulates the calibration league: `games` games between freshly generated teams. */
function runLeague(games: number, seed: number): Totals {
  const totals = emptyTotals()
  for (let i = 0; i < games; i++) {
    const [a, b] = calibrationPair(seed, i)
    addGame(totals, play(a, b, i, seed))
  }
  return totals
}

/** A copy of a team under a new id (and new player ids), so a team can play itself. */
function copyTeam(team: MatchTeam, id: string): MatchTeam {
  const roster = team.roster.map((p, i) => ({ ...p, id: `${id}-p${i + 1}` }))
  return { ...team, id, roster }
}

/** Population standard deviation. */
function standardDeviation(values: readonly number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
}

/**
 * Identical-team games: each generated team plays an exact copy of itself, home court
 * alternating. Every difference in the result is randomness (plus home court), which is what
 * the margin spread and overtime rate are meant to measure.
 */
function runIdentical(games: number, seed: number): Metric[] {
  const margins: number[] = []
  let overtimes = 0
  let homeWins = 0
  for (let i = 0; i < games; i++) {
    const [team] = calibrationPair(seed + 500, i)
    const result = play(copyTeam(team, 'A'), copyTeam(team, 'B'), i, seed)
    margins.push(result.home.points - result.away.points)
    if (result.periodsPlayed > PRO_RULES.periods) overtimes++
    if (result.home.points > result.away.points) homeWins++
  }
  const homeMargin = margins.reduce((s, m) => s + m, 0) / games
  // Final margins of exactly 11 or 12 (either way): a spike there means late intentional fouling
  // stopped at a fixed deficit cap.
  const elevenOrTwelve = margins.filter((m) => Math.abs(m) === 11 || Math.abs(m) === 12).length
  return [
    // Target 12–14: the real spread left once team strength is accounted for (≈ what's left after
    // betting lines), since identical teams have no strength gap at all.
    { label: 'Margin SD (points)', value: standardDeviation(margins), min: 12, max: 14, digits: 1 },
    { label: 'Overtime rate (games)', value: overtimes / games, min: 0.05, max: 0.07, digits: 3 },
    { label: 'Home win rate', value: homeWins / games, digits: 3 },
    { label: 'Home margin (points)', value: homeMargin, digits: 2 },
    { label: 'Finals decided by 11 or 12', value: elevenOrTwelve / games, digits: 3 },
  ]
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
 * Balance tests. Each generated team A is played against generated team B four ways,
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
    const [a, b] = calibrationPair(seed, i)
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
  /** League scoring: both teams' points per 100 possessions (A's offensive rating and B's, averaged). */
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

// --- System, fit and coaching experiments (--systems, report only) ---------------------------

/** Net rating of team A (by id) over `games` paired games, with both teams transformed per game. */
function pairedNet(
  games: number,
  seed: number,
  makeA: (a: MatchTeam, index: number) => MatchTeam,
  makeB: (b: MatchTeam, index: number) => MatchTeam = (b) => b,
): NetTally {
  const tally = emptyNet()
  for (let i = 0; i < games; i++) {
    const [a, b] = calibrationPair(seed, i)
    addNet(tally, play(makeA(a, i), makeB(b, i), i, seed))
  }
  return tally
}

/** Formats a signed number. */
function signed(value: number, digits = 2): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

/** A team with the same execution edge on both ends (balanced system): uniform fit or coaching. */
function uniformEdge(team: MatchTeam, edge: number): MatchTeam {
  return withCoaching(team, {
    system: BALANCED_SYSTEM,
    offensiveExecution: edge,
    defensiveExecution: edge,
  })
}

/** The starters (the five players who play nearly all the minutes until rotations exist). */
function starters(team: MatchTeam): MatchTeam['roster'] {
  return team.roster.slice(0, 5)
}

/** The archetype systems ranked by the starters' fit, best first. */
function rankedArchetypes(team: MatchTeam): { system: TeamSystem; fit: number }[] {
  return SYSTEM_ARCHETYPES.map((archetype) => {
    const system = archetypeSystem(archetype)
    return { system, fit: lineupFit(starters(team), system) }
  }).sort((x, y) => y.fit - x.fit)
}

/** The best- or worst-fitting archetype system for a team, with average coaching. */
function fittedCoaching(team: MatchTeam, best: boolean): TeamCoaching {
  const ranked = rankedArchetypes(team)
  const pick = best ? ranked[0] : ranked[ranked.length - 1]
  return averageCoaching((pick ?? ranked[0])?.system ?? BALANCED_SYSTEM)
}

/**
 * Calibration of the fit edge: every player at perfect fit (+1) vs. every player at poor fit (−1).
 * Fit and coach execution enter the engine at the same place, so a uniform execution edge of
 * ±FIT_EDGE on both ends is exactly a whole roster at ±1 fit. Compared with +1 on every attribute.
 */
function fitCalibration(games: number, seed: number): void {
  const base = netRating(pairedNet(games, seed, (a) => a))
  const perfect = netRating(pairedNet(games, seed, (a) => uniformEdge(a, FIT_EDGE)))
  const poor = netRating(pairedNet(games, seed, (a) => uniformEdge(a, -FIT_EDGE)))
  const plusOne = netRating(pairedNet(games, seed, (a) => boostTeam(a, VISIBLE_ATTRIBUTE_KEYS, 1)))
  const fitSpan = perfect - poor
  console.log(`Perfect vs. poor fit (±${FIT_EDGE} on every action): ${signed(fitSpan)} net rating`)
  console.log(`  (perfect ${signed(perfect - base)}, poor ${signed(poor - base)} vs. no system)`)
  console.log(`+1 on every attribute:                         ${signed(plusOne - base)} net rating`)
  console.log(
    `  => perfect vs. poor fit ≈ ${(fitSpan / (plusOne - base)).toFixed(2)} rating points`,
  )
}

/** Mean starters' fit gap between each team's best and worst archetype. */
function meanFitGap(games: number, seed: number): number {
  let total = 0
  for (let i = 0; i < games; i++) {
    const [a] = calibrationPair(seed, i)
    const ranked = rankedArchetypes(a)
    total += (ranked[0]?.fit ?? 0) - (ranked[ranked.length - 1]?.fit ?? 0)
  }
  return total / games
}

/**
 * Realistic fit: each generated team running its best-fitting vs. its worst-fitting archetype
 * (average coaching), both against the same opponent on balanced. Includes the systems' own lever
 * effects, which are roughly neutral for an average roster by design.
 */
function realisticFit(games: number, seed: number): void {
  const best = netRating(pairedNet(games, seed, (a) => withCoaching(a, fittedCoaching(a, true))))
  const worst = netRating(pairedNet(games, seed, (a) => withCoaching(a, fittedCoaching(a, false))))
  console.log(
    `Best- vs. worst-fitting archetype (starters' fit gap ${meanFitGap(games, seed).toFixed(2)}): ` +
      `${signed(best - worst)} net rating`,
  )
}

/** Wins of team A (by id) in a list of results. */
function winsOfA(results: readonly MatchResult[]): number {
  return results.filter((r) => sideOf(r, 'A')[0].points > sideOf(r, 'A')[1].points).length
}

/**
 * The Hawks test: team A in its best-fitting system vs. team B with +`edge` on every attribute in
 * its worst-fitting system, compared with the same matchup with no systems.
 */
function hawksTest(games: number, seed: number, edge: number): void {
  const fitted: MatchResult[] = []
  const plain: MatchResult[] = []
  for (let i = 0; i < games; i++) {
    const [a, b] = calibrationPair(seed, i)
    const better = boostTeam(b, VISIBLE_ATTRIBUTE_KEYS, edge)
    plain.push(play(a, better, i, seed))
    const aFit = withCoaching(a, fittedCoaching(a, true))
    fitted.push(play(aFit, withCoaching(better, fittedCoaching(better, false)), i, seed))
  }
  console.log(
    `Fitted A vs. poorly fitted B (+${edge} attributes): A wins ${(winsOfA(plain) / games).toFixed(3)} ` +
      `with no systems -> ${(winsOfA(fitted) / games).toFixed(3)} with systems`,
  )
}

/** A test coach with the given coaching attributes (everything else average) and preferred system. */
function testCoach(
  coaching: number,
  knowledge: number,
  adaptability: number,
  preferredSystem: TeamSystem,
): HeadCoach {
  return {
    id: 'coach',
    firstName: 'Test',
    lastName: 'Coach',
    age: 50,
    attributes: {
      offensiveCoaching: coaching,
      defensiveCoaching: coaching,
      tacticalKnowledge: knowledge,
      gameManagement: 10,
      rotationManagement: 10,
      playerEvaluation: 10,
      motivation: 10,
      playerDevelopment: 10,
      discipline: 10,
      worksWithYouth: 10,
    },
    hidden: { reputation: 50, adaptability },
    archetype: 'motionOffense',
    preferredSystem,
    contract: null,
  }
}

/** A system with every engine setting moved off `system` (the GM overrides everything). */
function fullOverride(system: TeamSystem): TeamSystem {
  const changed = { ...system }
  for (const setting of Object.keys(SETTING_OPTIONS) as SystemSetting[]) {
    const options = SETTING_OPTIONS[setting] as readonly string[]
    const other = options.find((option) => option !== system[setting])
    if (other) Object.assign(changed, { [setting]: other })
  }
  return changed
}

/**
 * Coach execution (best vs. worst coach on his own balanced system) and the familiarity penalty
 * (an average coach whose every setting is overridden, with no vs. full Adaptability/Knowledge).
 * The override runs the coach's preferred system for the team (his "override" is the balanced
 * system), so only the coaching edges differ, not the levers.
 */
function coachingExperiments(games: number, seed: number): void {
  /** Net rating of A with a coach's inputs on the balanced system. */
  const netWith = (coach: HeadCoach): number =>
    netRating(
      pairedNet(games, seed, (a) => withCoaching(a, coachingInputs(coach, BALANCED_SYSTEM))),
    )
  const best = netWith(testCoach(20, 10.5, 10.5, BALANCED_SYSTEM))
  const worst = netWith(testCoach(1, 10.5, 10.5, BALANCED_SYSTEM))
  console.log(
    `Best (20) vs. worst (1) coach, ±${EXECUTION_EDGE}: ${signed(best - worst)} net rating`,
  )
  const own = netWith(testCoach(10.5, 10.5, 10.5, BALANCED_SYSTEM))
  const rigid = netWith(testCoach(10.5, 1, 1, fullOverride(BALANCED_SYSTEM)))
  const flexible = netWith(testCoach(10.5, 20, 20, fullOverride(BALANCED_SYSTEM)))
  console.log(
    `Familiarity, every setting overridden: rigid coach ${signed(rigid - own)}, ` +
      `adaptable coach ${signed(flexible - own)} net rating`,
  )
}

/** Per-team-game stat deltas reported for each system option. */
function optionStats(t: Totals): {
  pace: number
  threeRate: number
  tov: number
  orb: number
  fb: number
} {
  return {
    pace: (t.possessions / t.minutes) * 48,
    threeRate: t.tpa / t.fga,
    tov: (t.turnovers / t.possessions) * 100,
    orb: t.offensiveRebounds / (t.offensiveRebounds + t.opponentDefensiveRebounds),
    fb: t.fastBreakPoints / t.teamGames,
  }
}

/** Totals for team A only over paired games (A's stats, B's defensive rebounds for ORB%). */
function teamATotals(games: number, seed: number, makeA: (a: MatchTeam) => MatchTeam): Totals {
  const totals = emptyTotals()
  for (let i = 0; i < games; i++) {
    const [a, b] = calibrationPair(seed, i)
    const result = play(makeA(a), b, i, seed)
    const [us, them] = sideOf(result, 'A')
    totals.games += 1
    addTeamGame(totals, us, them, gameMinutes(result))
  }
  return totals
}

/**
 * Each non-neutral option alone (average coaching, everything else balanced): net rating vs. the
 * balanced system and the stats it should move. Checks that each option is a trade-off (small net
 * effect for a typical roster) that still changes how the team plays.
 */
function optionTable(games: number, seed: number): void {
  const baseNet = netRating(pairedNet(games, seed, (a) => a))
  const base = optionStats(teamATotals(games, seed, (a) => a))
  console.log(
    `\n${'Option'.padEnd(34)} ${'Net'.padStart(6)} ${'Pace'.padStart(6)} ${'3PA%'.padStart(6)} ${'TOV'.padStart(6)} ${'ORB%'.padStart(6)} ${'FBpts'.padStart(6)}`,
  )
  for (const setting of Object.keys(FIT_DEMANDS) as SystemSetting[]) {
    for (const option of SETTING_OPTIONS[setting] as readonly string[]) {
      if (option === BALANCED_SYSTEM[setting]) continue
      const system = { ...BALANCED_SYSTEM, [setting]: option } as TeamSystem
      /** Team A running this one option. */
      const run = (a: MatchTeam): MatchTeam => withCoaching(a, averageCoaching(system))
      const net = netRating(pairedNet(games, seed, run)) - baseNet
      const s = optionStats(teamATotals(games, seed, run))
      console.log(
        `${`${setting}: ${option}`.padEnd(34)} ${signed(net, 1).padStart(6)} ${signed(s.pace - base.pace, 1).padStart(6)} ` +
          `${signed((s.threeRate - base.threeRate) * 100, 1).padStart(6)} ${signed(s.tov - base.tov, 1).padStart(6)} ` +
          `${signed((s.orb - base.orb) * 100, 1).padStart(6)} ${signed(s.fb - base.fb, 1).padStart(6)}`,
      )
    }
  }
}

/** The --systems experiments (report only; no targets). */
function runSystemExperiments(games: number, seed: number): void {
  console.log(`\nSystem experiments (${games} paired games each, report only)`)
  console.log('-'.repeat(64))
  fitCalibration(games, seed)
  realisticFit(games, seed)
  hawksTest(games, seed, 0.5)
  coachingExperiments(games, seed)
  optionTable(games, seed)
}

/** Prints each system option's raw fit mean and SD over generated league players (--fit-stats). */
function printFitStats(seed: number): void {
  const bases = []
  for (let i = 0; i < 300; i++) {
    const rng = createRng(seed * 9_001 + i)
    for (const player of generateTeam(rng, { id: 't' }).roster) bases.push(fitBasis(player))
  }
  console.log(`\nRaw fit over ${bases.length} generated players (FitDemand.center = mean)`)
  for (const [setting, options] of Object.entries(FIT_DEMANDS)) {
    for (const [option, demand] of Object.entries(options as Record<string, FitDemand>)) {
      const values = bases.map((basis) => rawFit(basis, demand))
      const mean = values.reduce((s, v) => s + v, 0) / values.length
      console.log(
        `${`${setting}: ${option}`.padEnd(34)} mean ${mean.toFixed(2)}  SD ${standardDeviation(values).toFixed(2)}`,
      )
    }
  }
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
  useAverageTeams = process.argv.includes('--average')
  useLeagueSystems = process.argv.includes('--league-systems')
  const started = Date.now()
  if (process.argv.includes('--fit-stats')) {
    printFitStats(seed)
    return
  }
  printReport(runLeague(games, seed))
  printMetrics(
    `Identical teams (${games} games, each team vs. a copy of itself)`,
    runIdentical(games, seed),
  )
  if (process.argv.includes('--balance')) runBalance(numberArg('balance-games', games), seed)
  if (process.argv.includes('--systems')) {
    // The experiments compare systems against no system, so they never use --league-systems teams.
    useLeagueSystems = false
    runSystemExperiments(numberArg('systems-games', 400), seed)
  }
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)} s`)
}

main()
