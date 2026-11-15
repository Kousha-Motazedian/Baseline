import type { Rng } from '../shared/rng.ts'
import type { TeamFinances } from '../finances/teamFinances.ts'
import { teamCoachCap } from '../finances/teamFinances.ts'
import type { LeagueRules } from '../world/rules.ts'
import { drawCoachQuality, generateCoach } from './coachGenerator.ts'
import {
  canAffordCoach,
  coachSpending,
  contractYears,
  offerContract,
  salaryDemand,
} from './contracts.ts'
import type { HeadCoach } from './types.ts'

/**
 * The coach market: every team's head coach plus the pool of unemployed coaches. Hiring and
 * firing (hiring.ts) are pure functions from one market to the next.
 */

/** Head coaches by team and the unemployed coach pool. */
export interface CoachMarket {
  /** Each team's head coach (always with a contract), keyed by team id. Absent = vacant. */
  headCoaches: Readonly<Record<string, HeadCoach>>
  /** Unemployed coaches (contract null) available to hire. */
  pool: readonly HeadCoach[]
  /**
   * Coaches each team has fired, by team id (coach ids in firing order). The AI never re-hires
   * one of these for the same team; other teams and the GM's own hireCoach are unaffected. Plain
   * data so saves serialise it as is. Cleared by clearFiredHistory (hiring.ts) when the pool is
   * refreshed.
   */
  firedBy: Readonly<Record<string, readonly string[]>>
}

/**
 * Pool size as a share of the league's teams: 0.4 gives 12 available coaches for 30 teams, enough
 * that every vacancy has real choices without flooding the market.
 */
const POOL_SHARE = 0.4

/**
 * Mean quality of unemployed coaches, below the league-wide average: the best coaches mostly have
 * jobs, so the pool is mostly fringe candidates, with the occasional gem from the normal spread.
 */
const POOL_QUALITY_MEAN = 9.5

/** Generates `count` coaches with ids `${idPrefix}1`, `${idPrefix}2`, ..., each drawn at `mean`. */
function generateCoaches(rng: Rng, count: number, idPrefix: string, mean?: number): HeadCoach[] {
  return Array.from({ length: count }, (_, i) =>
    generateCoach(rng, { id: `${idPrefix}${i + 1}`, quality: drawCoachQuality(rng, mean) }),
  )
}

/**
 * A pool of `count` unemployed coaches. `idPrefix` keeps ids unique when pools are refreshed
 * later (e.g. one prefix per season).
 */
export function generateCoachPool(rng: Rng, count: number, idPrefix = 'FA'): HeadCoach[] {
  return generateCoaches(rng, count, idPrefix, POOL_QUALITY_MEAN)
}

/** The number of pool coaches a league of `teamCount` teams starts with. */
export function startingPoolSize(teamCount: number): number {
  return Math.round(teamCount * POOL_SHARE)
}

/** A coach signed at his salary demand, on a contract length he accepts. */
function signCoach(rng: Rng, coach: HeadCoach, rules: LeagueRules): HeadCoach {
  return { ...coach, contract: offerContract(coach, rules, contractYears(rng, coach)) }
}

/** How many replacement coaches a team whose drawn coach is too pricey may be offered. */
const MAX_REPLACEMENT_DRAWS = 25

/**
 * Picks the coach a team starts with: the drawn one if its cap covers his demand, else
 * replacements drawn from the same distribution (new ids from `nextId`) until one fits. If none of
 * the draws fit (practically impossible, since the cheapest demands are far below the lowest cap),
 * the cheapest one seen is used.
 */
function affordableCoach(
  rng: Rng,
  drawn: HeadCoach,
  cap: number,
  rules: LeagueRules,
  nextId: () => string,
): HeadCoach {
  let best = drawn
  for (let tries = 0; tries < MAX_REPLACEMENT_DRAWS; tries++) {
    if (canAffordCoach(0, salaryDemand(best, rules), cap)) return best
    const candidate = generateCoach(rng, { id: nextId(), quality: drawCoachQuality(rng) })
    if (salaryDemand(candidate, rules) < salaryDemand(best, rules)) best = candidate
  }
  return best
}

/**
 * League setup: every team gets a newly generated head coach under contract (ids "HC1", "HC2",
 * ...), and a pool of unemployed coaches is generated alongside. Coaches are dealt to teams in the
 * given order; teams aren't matched to coaches by quality, so a bad team can have a good coach.
 * Each team's own coach cap is respected: a team whose drawn coach asks more than it can afford
 * gets a cheaper one (the pricey coach simply isn't in this league).
 */
export function assignLeagueCoaches(
  rng: Rng,
  teamIds: readonly string[],
  rules: LeagueRules,
  finances: Readonly<Record<string, TeamFinances>>,
): CoachMarket {
  const coaches = generateCoaches(rng, teamIds.length, 'HC')
  let replacements = 0
  /** The next unused head-coach id, continuing after the last dealt `HC` id. */
  const nextId = (): string => `HC${teamIds.length + ++replacements}`
  const headCoaches: Record<string, HeadCoach> = {}
  teamIds.forEach((teamId, i) => {
    const teamFinances = finances[teamId]
    if (teamFinances === undefined)
      throw new RangeError(`assignLeagueCoaches: no finances for ${teamId}`)
    const cap = teamCoachCap(teamFinances, rules)
    const coach = affordableCoach(rng, coaches[i] as HeadCoach, cap, rules, nextId)
    headCoaches[teamId] = signCoach(rng, coach, rules)
  })
  const pool = generateCoachPool(rng, startingPoolSize(teamIds.length))
  return { headCoaches, pool, firedBy: {} }
}

/** A team's coaching salaries this season (fired coaches are free; see coachSpending). */
export function teamCoachSpending(market: CoachMarket, teamId: string): number {
  return coachSpending(market.headCoaches[teamId])
}
