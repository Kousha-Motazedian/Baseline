/**
 * Batch simulator for calibration and balance checks.
 *
 *   npm run sim:batch                      2,000 games between generated league teams
 *   npm run sim:batch -- --games 5000      more games (tighter averages)
 *   npm run sim:batch -- --seed 42         different random league
 *   npm run sim:batch -- --balance         also run the offense-vs-defense balance tests
 *   npm run sim:batch -- --average         uniform average teams (no stars) instead of league teams
 *   npm run sim:batch -- --league-systems  every league team has a generated head coach (real attributes)
 *   npm run sim:batch -- --rotation-probe  substitutions and plan gap with every coach at RM 1 / 10.5 / 20 (and GM 1 / 20)
 *   npm run sim:batch -- --identical-only  only the identical-teams games (quick overtime-rate check)
 *   npm run sim:batch -- --gm-probe        (alone) close-game win rate of Game Management 20 / 10.5 / 1 coaches, talent equal
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
import { generateCoach } from '../src/core/staff/coachGenerator.ts'
import { coachingInputs } from '../src/core/tactics/coaching.ts'
import { matchTeamFor } from '../src/core/tactics/matchTeam.ts'
import type { RotationPlan } from '../src/core/tactics/rotation.ts'
import { buildRotationPlan } from '../src/core/tactics/rotation.ts'
import type { FitDemand } from '../src/core/tactics/fit.ts'
import { FIT_DEMANDS, fitBasis, lineupFit, rawFit } from '../src/core/tactics/fit.ts'
import type { SystemSetting, TeamSystem } from '../src/core/tactics/system.ts'
import {
  archetypeSystem,
  BALANCED_SYSTEM,
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
  /** Timeouts taken and 2-for-1 shots attempted, summed over team-games. */
  timeouts: number
  twoForOnes: number
  /** Sum over team-games of the team's top scorer's points. */
  topScorerPoints: number
  /** Sum over team-games of the starters' average minutes. */
  starterMinutes: number
  /** Sum over team-games of the most minutes any player played. */
  topMinutes: number
  /** Sum over team-games of the players with 10+ minutes. */
  tenMinutePlayers: number
  /** Sum over team-games of the team's rebound and assist leaders' totals. */
  topRebounds: number
  topAssists: number
  /** Games in which some player scored 40+ (and 50+). */
  games40: number
  games50: number
  /** Sum of the winning margins, and games decided by 20 or more. */
  winMargin: number
  /** Rotation checks (see addRotation): subs, plan gap and end-of-bench minutes. */
  rotation: RotationTotals
  blowouts: number
  /** Sum and sum of squares of the signed (home - away) margin. */
  marginSum: number
  marginSquares: number
  playTypeAttempts: Record<PlayType, number>
  playTypeMakes: Record<PlayType, number>
}

/** Rotation-quality sums, overall and by the coach's Rotation Management bucket. */
interface RotationTotals {
  teamGames: number
  /** Substitutions ("X checks in for Y") by both teams, summed over games. */
  subs: number
  games: number
  /** Player-seconds on the floor below 40 energy. */
  exhaustedSeconds: number
  /** Seconds played by players the plan gives 0 minutes (the end of the bench), and all player seconds. */
  endBenchSeconds: number
  teamSeconds: number
  /** The same end-of-bench seconds in games decided by fewer than 10 points, and those team-games. */
  closeEndBenchSeconds: number
  closeTeamGames: number
  /** Sum over team-games of the mean |played - planned| minutes of players with planned minutes. */
  planGap: number
  /** Team-games, subs and plan gap by Rotation Management bucket (low, mid, high). */
  buckets: { teamGames: number; subs: number; planGap: number; exhausted: number }[]
}

/** Rotation Management bucket edges: low is at most 8, high is above 13. */
const RM_LOW = 8
const RM_HIGH = 13

/** Index of the Rotation Management bucket for a rating. */
function rmBucket(rating: number): number {
  return rating <= RM_LOW ? 0 : rating > RM_HIGH ? 2 : 1
}

/** An all-zero rotation tally. */
function emptyRotationTotals(): RotationTotals {
  return {
    teamGames: 0,
    subs: 0,
    games: 0,
    exhaustedSeconds: 0,
    endBenchSeconds: 0,
    teamSeconds: 0,
    closeEndBenchSeconds: 0,
    closeTeamGames: 0,
    planGap: 0,
    buckets: [0, 1, 2].map(() => ({ teamGames: 0, subs: 0, planGap: 0, exhausted: 0 })),
  }
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
    timeouts: 0,
    twoForOnes: 0,
    topScorerPoints: 0,
    starterMinutes: 0,
    topMinutes: 0,
    tenMinutePlayers: 0,
    topRebounds: 0,
    topAssists: 0,
    games40: 0,
    winMargin: 0,
    rotation: emptyRotationTotals(),
    marginSum: 0,
    marginSquares: 0,
    blowouts: 0,
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
  totals.timeouts += team.timeouts
  totals.twoForOnes += team.twoForOnes
  for (const type of PLAY_TYPES) {
    totals.playTypeAttempts[type] += team.shotsByPlayType[type].attempted
    totals.playTypeMakes[type] += team.shotsByPlayType[type].made
  }
}

/** The rotation plan a team plays with: its own, or the one the engine builds when it has none. */
function planOf(team: MatchTeam): RotationPlan {
  return (
    team.rotation ??
    buildRotationPlan(team.roster, undefined, team.coaching?.system ?? BALANCED_SYSTEM)
  )
}

/** Adds one team-game's rotation numbers (subs, plan gap, end-of-bench minutes). */
function addRotation(totals: Totals, result: MatchResult, team: MatchTeam, side: TeamResult): void {
  const r = totals.rotation
  const plan = planOf(team)
  const margin = Math.abs(result.home.points - result.away.points)
  const subs = result.playByPlay.filter(
    (e) => e.teamId === side.teamId && e.text.includes(' checks in for '),
  ).length
  let gap = 0
  let planned = 0
  for (const line of side.players) {
    r.teamSeconds += line.secondsPlayed
    // The end of the bench: players the plan gives no minutes at all.
    if ((plan.targetSeconds[line.playerId] ?? 0) <= 0) {
      r.endBenchSeconds += line.secondsPlayed
      if (margin < 10) r.closeEndBenchSeconds += line.secondsPlayed
    }
    const target = plan.targetSeconds[line.playerId] ?? 0
    if (target > 0) {
      gap += Math.abs(line.secondsPlayed - target) / 60
      planned += 1
    }
  }
  const meanGap = planned > 0 ? gap / planned : 0
  r.teamGames += 1
  r.exhaustedSeconds += side.exhaustedSeconds
  r.subs += subs
  r.planGap += meanGap
  if (margin < 10) r.closeTeamGames += 1
  const bucket = r.buckets[rmBucket(team.rotationCoach?.rotationManagement ?? 10.5)]
  if (bucket) {
    bucket.teamGames += 1
    bucket.subs += subs
    bucket.planGap += meanGap
    bucket.exhausted += side.exhaustedSeconds
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

/** Adds one team-game's minutes and individual-leader numbers (rotation calibration). */
function addPlayerLevel(totals: Totals, team: TeamResult): void {
  const starters = team.players.filter((line) => line.started)
  const starterSeconds = starters.reduce((sum, line) => sum + line.secondsPlayed, 0)
  totals.starterMinutes += starterSeconds / Math.max(1, starters.length) / 60
  totals.topMinutes += Math.max(0, ...team.players.map((line) => line.secondsPlayed)) / 60
  totals.tenMinutePlayers += team.players.filter((line) => line.secondsPlayed >= 600).length
  totals.topRebounds += Math.max(
    0,
    ...team.players.map((line) => line.offensiveRebounds + line.defensiveRebounds),
  )
  totals.topAssists += Math.max(0, ...team.players.map((line) => line.assists))
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
function addGame(totals: Totals, result: MatchResult, teams: Record<string, MatchTeam> = {}): void {
  const minutes = gameMinutes(result)
  totals.games += 1
  if (result.periodsPlayed > PRO_RULES.periods) totals.overtimeGames += 1
  addTeamGame(totals, result.home, result.away, minutes)
  addTeamGame(totals, result.away, result.home, minutes)
  addTopScorers(totals, result)
  for (const side of [result.home, result.away]) {
    const team = teams[side.teamId]
    if (team) addRotation(totals, result, team, side)
  }
  totals.rotation.games += 1
  const margin = Math.abs(result.home.points - result.away.points)
  totals.winMargin += margin
  totals.marginSum += result.home.points - result.away.points
  totals.marginSquares += (result.home.points - result.away.points) ** 2
  if (margin >= 20) totals.blowouts += 1
  addPlayerLevel(totals, result.home)
  addPlayerLevel(totals, result.away)
}

/** One league-average stat with its real-world target range (no range = reported only). */
interface Metric {
  label: string
  value: number
  min?: number
  max?: number
  digits: number
}

/**
 * Paired games per balance test (at least). The offense:defense ratio divides two noisy gains, so
 * 2,000 games leave it +-0.1 between seeds; 6,000 brings that to about +-0.06.
 */
const BALANCE_MIN_GAMES = 6000

/** Real league-game margin SD range (about 15.5, from the 2021-22 to 2025-26 seasons). */
const LEAGUE_MARGIN_SD_MIN = 14.5
const LEAGUE_MARGIN_SD_MAX = 16.5

/** Standard deviation of the signed home-minus-away margin over the league games. */
function marginSd(t: Totals): number {
  const mean = t.marginSum / t.games
  return Math.sqrt(t.marginSquares / t.games - mean * mean)
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
    // Timeouts and 2-for-1s (docs/design/timeouts.md, section 5): about 6 of 7 timeouts used, and
    // about 1-2 quick 2-for-1 shots attempted per team-game.
    {
      label: 'Timeouts / team-game',
      value: t.timeouts / t.teamGames,
      min: 5.5,
      max: 6.5,
      digits: 2,
    },
    {
      label: '2-for-1 attempts / team-game',
      value: t.twoForOnes / t.teamGames,
      min: 1,
      max: 2,
      digits: 2,
    },
    // Individual box-score checks (rotations; see docs/design/rotations.md section 5). Minutes
    // include overtime. The 40+/50+ rows count games where EITHER team had such a scorer.
    {
      label: 'Starter minutes (team avg)',
      value: t.starterMinutes / t.teamGames,
      min: 30,
      max: 33,
      digits: 1,
    },
    {
      label: 'Most minutes on a team',
      value: t.topMinutes / t.teamGames,
      min: 34,
      max: 38,
      digits: 1,
    },
    {
      label: 'Players with 10+ min / team',
      value: t.tenMinutePlayers / t.teamGames,
      min: 8,
      max: 10,
      digits: 2,
    },
    {
      label: 'Team top scorer (pts)',
      value: t.topScorerPoints / t.teamGames,
      min: 26,
      max: 29,
      digits: 1,
    },
    // Real 2021-22 to 2025-26 pro seasons: average margin of victory 12.4, 19.5% of games
    // decided by 20 or more (user decision, rotations step).
    {
      label: 'Avg margin of victory',
      value: t.winMargin / t.games,
      min: 11.9,
      max: 12.9,
      digits: 2,
    },
    // Rotation quality (rotations.md): real NBA games have about 40-50 substitutions between both
    // teams, and the end of the bench (players with no planned minutes) plays about 3-6% of the minutes.
    {
      label: 'Substitutions / game (both teams)',
      value: t.rotation.subs / t.rotation.games,
      min: 40,
      max: 55,
      digits: 1,
    },
    {
      label: 'Zero-plan players, share of min',
      value: t.rotation.endBenchSeconds / t.rotation.teamSeconds,
      min: 0,
      max: 0.06,
      digits: 3,
    },
    {
      label: 'Zero-plan min, games < 10 pts',
      value: t.rotation.closeEndBenchSeconds / 60 / Math.max(1, t.rotation.closeTeamGames),
      min: 0,
      max: 2,
      digits: 2,
    },
    {
      label: 'Plan gap (min / player)',
      value: t.rotation.planGap / t.rotation.teamGames,
      digits: 2,
    },
    {
      // Real league-game spread: average |margin| 12.4 ~ 0.8 x SD, so SD ~ 15.5. It includes the
      // spread in team quality, which identical teams lack (see the identical-teams target).
      label: 'League-game margin SD',
      value: marginSd(t),
      min: LEAGUE_MARGIN_SD_MIN,
      max: LEAGUE_MARGIN_SD_MAX,
      digits: 1,
    },
    { label: 'Games decided by 20+', value: t.blowouts / t.games, min: 0.17, max: 0.22, digits: 3 },
    {
      label: 'Games with a 40+ scorer',
      value: t.games40 / t.games,
      min: 0.1,
      max: 0.16,
      digits: 3,
    },
    {
      label: 'Games with a 50+ scorer',
      value: t.games50 / t.games,
      min: 0,
      max: 0.02,
      digits: 3,
    },
    {
      label: 'Team rebound leader',
      value: t.topRebounds / t.teamGames,
      min: 10,
      max: 12,
      digits: 1,
    },
    {
      label: 'Team assist leader',
      value: t.topAssists / t.teamGames,
      min: 7,
      max: 9,
      digits: 1,
    },
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

  printRotationBuckets(t)
  console.log(`\n${'Play type'.padEnd(12)} ${'Share of FGA'.padStart(12)} ${'FG%'.padStart(7)}`)
  for (const type of PLAY_TYPES) {
    const attempts = t.playTypeAttempts[type]
    const share = ((attempts / t.fga) * 100).toFixed(1) + '%'
    const pct = (t.playTypeMakes[type] / attempts).toFixed(3)
    console.log(`${type.padEnd(12)} ${share.padStart(12)} ${pct.padStart(7)}`)
  }
}

/** Prints substitutions per game and the plan gap by the coach's Rotation Management bucket. */
function printRotationBuckets(t: Totals): void {
  console.log(
    '\nRotation Management bucket   team-games   subs / team-game   plan gap (min)   exhausted min/game',
  )
  const names = ['low (<= 8)', 'mid (8-13)', 'high (> 13)']
  t.rotation.buckets.forEach((b, i) => {
    if (b.teamGames === 0) return
    const subs = (b.subs / b.teamGames).toFixed(1)
    const gap = (b.planGap / b.teamGames).toFixed(2)
    console.log(
      `${(names[i] ?? '').padEnd(28)} ${String(b.teamGames).padStart(10)} ${subs.padStart(18)} ${gap.padStart(16)} ${(b.exhausted / b.teamGames / 60).toFixed(1).padStart(19)}`,
    )
  })
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
 * Every league team has a generated head coach (real attributes) running his own preferred
 * system, with his rotation plan and substitution attributes (`--league-systems`). Set once in
 * main(). Off by default, so the targets check today's engine.
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
 * A generated head coach (real attributes, own preferred system) for game `index`, from its own
 * RNG stream so the teams themselves are the same with or without --league-systems.
 */
function randomCoach(seed: number, index: number, side: number): HeadCoach {
  const rng = createRng(seed * 300_007 + index * 2 + side)
  return generateCoach(rng, { id: `coach-${index}-${side}` })
}

/** Generates the two teams for game `index` of a league seeded with `seed`. */
function calibrationPair(seed: number, index: number): [MatchTeam, MatchTeam] {
  const rng = createRng(seed * 100_003 + index)
  const a = calibrationTeam(rng, 'A')
  const b = calibrationTeam(rng, 'B')
  if (!useLeagueSystems) return [a, b]
  return [
    matchTeamFor(a, { coach: randomCoach(seed, index, 0) }),
    matchTeamFor(b, { coach: randomCoach(seed, index, 1) }),
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
  try {
    return simulateGame({
      home: teamIsHome ? team : opponent,
      away: teamIsHome ? opponent : team,
      rules: PRO_RULES,
      seed: seed * 7_919 + index,
    })
  } catch (error) {
    // Name the game, so a stuck one can be reproduced.
    console.error(`Game failed: seed ${seed}, index ${index}`)
    throw error
  }
}

/**
 * The generator's team-quality spread: the SD of the expected margin between two generated
 * teams. Each pair plays `gamesPer` games (home court alternating, so it cancels); the variance
 * of the pair means is spread^2 + noise^2 / gamesPer, so the identical-teams noise is subtracted.
 */
function qualitySpread(seed: number, pairs: number, gamesPer: number, noiseSd: number): number {
  const means: number[] = []
  for (let i = 0; i < pairs; i++) {
    const [a, b] = calibrationPair(seed + 900, i)
    let sum = 0
    for (let g = 0; g < gamesPer; g++) {
      const r = play(a, b, g, seed + i * 31)
      // Margin from team A's side, whoever was at home.
      sum += (g % 2 === 0 ? 1 : -1) * (r.home.points - r.away.points)
    }
    means.push(sum / gamesPer)
  }
  const variance = standardDeviation(means) ** 2 - noiseSd ** 2 / gamesPer
  return Math.sqrt(Math.max(0, variance))
}

/**
 * Plays the calibration league with every coach forced to one Rotation Management and Game
 * Management (`--rotation-probe`), to see how those attributes change substitutions and minutes.
 */
function runRotationProbe(games: number, seed: number): void {
  console.log('\nRotation probe (every coach at the given rating, balanced system)')
  console.log('RM     GM     subs/game   plan gap   zero-plan   exhausted min/team-game')
  for (const [rm, gm] of [
    [1, 10.5],
    [10.5, 10.5],
    [20, 10.5],
    [10.5, 1],
    [10.5, 20],
  ] as const) {
    const totals = emptyTotals()
    for (let i = 0; i < games; i++) {
      const [a, b] = calibrationPair(seed, i)
      const coached = (team: MatchTeam): MatchTeam => ({
        ...team,
        rotationCoach: { rotationManagement: rm, gameManagement: gm },
      })
      const home = coached(a)
      const away = coached(b)
      addGame(totals, play(home, away, i, seed), { [home.id]: home, [away.id]: away })
    }
    const r = totals.rotation
    console.log(
      `${String(rm).padEnd(6)} ${String(gm).padEnd(6)} ${(r.subs / r.games).toFixed(1).padStart(9)} ${(r.planGap / r.teamGames).toFixed(2).padStart(10)} ${(r.endBenchSeconds / r.teamSeconds).toFixed(3).padStart(11)} ${(r.exhaustedSeconds / r.teamGames / 60).toFixed(1).padStart(24)}`,
    )
  }
}

/**
 * The score as the last 5:00 of regulation begins (from the play-by-play): [home, away]. The last
 * entry before the final period's 5:00 mark carries it; 0-0 if nothing was logged before it.
 */
function scoreWithFiveLeft(result: MatchResult): [number, number] {
  const mark = PRO_RULES.periods
  let home = 0
  let away = 0
  for (const entry of result.playByPlay) {
    if (entry.period > mark || (entry.period === mark && entry.clockSeconds <= 300)) break
    home = entry.homeScore
    away = entry.awayScore
  }
  return [home, away]
}

/** A copy of `team` whose coach has this Game Management (everything else neutral). */
function withGameManagement(team: MatchTeam, gameManagement: number): MatchTeam {
  return { ...team, rotationCoach: { rotationManagement: 10.5, gameManagement } }
}

/**
 * Close-game win rate of Game Management coaches, talent equal (`--gm-probe`): a team plays a
 * copy of itself with only the coach's Game Management differing. Close = within 5 points when
 * the last 5:00 begins. Target (docs/design/timeouts.md): top vs. poor about +5 points.
 */
function runGameManagementProbe(games: number, seed: number): void {
  console.log('\nGame Management probe (identical teams; close = within 5 at the 5:00 mark)')
  console.log('matchup            games   close   close win rate of first   gap (pts)   OT rate')
  for (const [first, second] of [
    [20, 1],
    [20, 10.5],
    [10.5, 1],
  ] as const) {
    let close = 0
    let firstWins = 0
    let overtimes = 0
    for (let i = 0; i < games; i++) {
      const [team] = calibrationPair(seed + 700, i)
      const a = withGameManagement(copyTeam(team, 'A'), first)
      const b = withGameManagement(copyTeam(team, 'B'), second)
      const result = play(a, b, i, seed)
      if (result.periodsPlayed > PRO_RULES.periods) overtimes++
      const [home, away] = scoreWithFiveLeft(result)
      if (Math.abs(home - away) > 5) continue
      close++
      const aIsHome = result.home.teamId === 'A'
      if (result.home.points > result.away.points === aIsHome) firstWins++
    }
    const rate = firstWins / close
    console.log(
      `GM ${String(first).padEnd(4)} vs ${String(second).padEnd(6)} ${String(games).padStart(8)} ${String(close).padStart(7)} ${rate.toFixed(3).padStart(14)} ${((2 * rate - 1) * 100).toFixed(1).padStart(20)} ${(overtimes / games).toFixed(3).padStart(10)}`,
    )
  }
}

/** Simulates the calibration league: `games` games between freshly generated teams. */
function runLeague(games: number, seed: number): Totals {
  const totals = emptyTotals()
  for (let i = 0; i < games; i++) {
    const [a, b] = calibrationPair(seed, i)
    addGame(totals, play(a, b, i, seed), { [a.id]: a, [b.id]: b })
  }
  return totals
}

/** A copy of a team under a new id (and new player ids), so a team can play itself. */
function copyTeam(team: MatchTeam, id: string): MatchTeam {
  const rename = new Map(team.roster.map((p, i) => [p.id, `${id}-p${i + 1}`]))
  const roster = team.roster.map((p) => ({ ...p, id: rename.get(p.id) ?? p.id }))
  const renamed = (ids: readonly string[]): string[] => ids.map((pid) => rename.get(pid) ?? pid)
  const plan = team.rotation
  const rotation = plan && {
    starters: renamed(plan.starters),
    order: renamed(plan.order),
    closers: renamed(plan.closers),
    targetSeconds: Object.fromEntries(
      Object.entries(plan.targetSeconds).map(([pid, seconds]) => [rename.get(pid) ?? pid, seconds]),
    ),
  }
  return { ...team, id, roster, ...(rotation ? { rotation } : {}) }
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
function runIdentical(games: number, seed: number): IdenticalRun {
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
  return { margins, overtimes, homeWins }
}

/** Raw results of the identical-teams games. */
interface IdenticalRun {
  margins: number[]
  overtimes: number
  homeWins: number
}

/** The identical-teams metrics, with the margin-SD target derived from the quality spread. */
function identicalMetrics(run: IdenticalRun, spread: number): Metric[] {
  const { margins, overtimes, homeWins } = run
  const games = margins.length
  const homeMargin = margins.reduce((s, m) => s + m, 0) / games
  // Final margins of exactly 11 or 12 (either way): a spike there means late intentional fouling
  // stopped at a fixed deficit cap.
  const elevenOrTwelve = margins.filter((m) => Math.abs(m) === 11 || Math.abs(m) === 12).length
  return [
    // Target: the real league-game SD range with OUR generator's quality spread taken out, since
    // identical teams have no strength gap: sqrt(league SD^2 - spread^2). See match-engine.md.
    {
      label: 'Margin SD (points)',
      value: standardDeviation(margins),
      min: Math.sqrt(LEAGUE_MARGIN_SD_MIN ** 2 - spread ** 2),
      max: Math.sqrt(LEAGUE_MARGIN_SD_MAX ** 2 - spread ** 2),
      digits: 1,
    },
    { label: 'Generator quality spread (SD)', value: spread, digits: 2 },
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
  if (process.argv.includes('--gm-probe')) {
    // Standalone: the probe plays its own identical-team games.
    runGameManagementProbe(numberArg('gm-games', 12000), seed)
    return
  }
  if (process.argv.includes('--identical-only')) {
    // Quick overtime / margin check: skips the league games and the quality-spread estimate.
    printMetrics(`Identical teams (${games} games)`, identicalMetrics(runIdentical(games, seed), 0))
    return
  }
  printReport(runLeague(games, seed))
  // The identical-teams noise, then the team-quality spread it implies for the generator.
  const identical = runIdentical(games, seed)
  const spread = qualitySpread(seed, 400, 6, standardDeviation(identical.margins))
  printMetrics(
    `Identical teams (${games} games, each team vs. a copy of itself)`,
    identicalMetrics(identical, spread),
  )
  if (process.argv.includes('--balance'))
    runBalance(numberArg('balance-games', Math.max(games, BALANCE_MIN_GAMES)), seed)
  if (process.argv.includes('--gm-probe'))
    runGameManagementProbe(numberArg('gm-games', 12000), seed)
  if (process.argv.includes('--rotation-probe'))
    runRotationProbe(numberArg('probe-games', 400), seed)
  if (process.argv.includes('--systems')) {
    // The experiments compare systems against no system, so they never use --league-systems teams.
    useLeagueSystems = false
    runSystemExperiments(numberArg('systems-games', 400), seed)
  }
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)} s`)
}

main()
