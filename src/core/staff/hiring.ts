import type { Rng } from '../shared/rng.ts'
import type { TeamFinances } from '../finances/teamFinances.ts'
import { teamCoachCap } from '../finances/teamFinances.ts'
import type { LeagueRules } from '../world/rules.ts'
import { coachQuality } from './coachGenerator.ts'
import { canAffordCoach, contractYears, offerContract, salaryDemand } from './contracts.ts'
import type { CoachMarket } from './market.ts'
import { teamCoachSpending } from './market.ts'
import type { HeadCoach } from './types.ts'

/**
 * Hiring and firing head coaches. Every function is pure: it returns a new CoachMarket and never
 * mutates the one passed in.
 */

/**
 * Fires a team's head coach: he returns to the pool unemployed and the job becomes vacant. Free for
 * now: his remaining salary stops counting against the coach cap at once (see coachSpending and
 * docs/TODO.md, "Full team finances", where firing becomes costly).
 */
export function fireCoach(market: CoachMarket, teamId: string): CoachMarket {
  const coach = market.headCoaches[teamId]
  if (coach === undefined) throw new RangeError(`fireCoach: team ${teamId} has no head coach`)
  const headCoaches = Object.fromEntries(
    Object.entries(market.headCoaches).filter(([id]) => id !== teamId),
  )
  const firedBy = { ...market.firedBy, [teamId]: [...(market.firedBy[teamId] ?? []), coach.id] }
  return { headCoaches, pool: [...market.pool, { ...coach, contract: null }], firedBy }
}

/**
 * Forgets who fired whom. Call when the coach pool is refreshed at the season rollover (the season
 * loop doesn't exist yet): the exclusion lasts for the current pool only, so a fired coach can be
 * considered again next offseason, when a fresh market makes a reunion plausible rather than
 * an instant boomerang.
 */
export function clearFiredHistory(market: CoachMarket): CoachMarket {
  return { ...market, firedBy: {} }
}

/**
 * True if the team could hire this coach at his salary demand without passing its own coach cap
 * (set by its finances).
 */
export function canTeamAffordCoach(
  market: CoachMarket,
  teamId: string,
  coach: HeadCoach,
  rules: LeagueRules,
  finances: TeamFinances,
): boolean {
  return canAffordCoach(
    teamCoachSpending(market, teamId),
    salaryDemand(coach, rules),
    teamCoachCap(finances, rules),
  )
}

/**
 * Hires a pool coach as a team's head coach at his salary demand for `years` seasons. The job must
 * be vacant (fire the current coach first) and the salary must fit under the team's coach cap.
 */
export function hireCoach(
  market: CoachMarket,
  teamId: string,
  coachId: string,
  rules: LeagueRules,
  finances: TeamFinances,
  years: number,
): CoachMarket {
  if (market.headCoaches[teamId] !== undefined) {
    throw new RangeError(`hireCoach: team ${teamId} already has a head coach`)
  }
  const coach = market.pool.find((c) => c.id === coachId)
  if (coach === undefined) throw new RangeError(`hireCoach: coach ${coachId} is not in the pool`)
  if (!canTeamAffordCoach(market, teamId, coach, rules, finances)) {
    throw new RangeError(`hireCoach: team ${teamId} cannot afford coach ${coachId}`)
  }
  const signed: HeadCoach = { ...coach, contract: offerContract(coach, rules, years) }
  return {
    ...market,
    headCoaches: { ...market.headCoaches, [teamId]: signed },
    pool: market.pool.filter((c) => c.id !== coachId),
  }
}

/**
 * AI ranking of two candidates (negative = `a` first). Reputation first, then the quality
 * estimate, then id for determinism. AI front offices lean on reputation like a weak human
 * evaluator does: it is the visible, consensus number. That is deliberate, so a user who reads
 * the actual attributes can find underrated coaches the AI passes over.
 */
function compareCandidates(a: HeadCoach, b: HeadCoach): number {
  return (
    b.hidden.reputation - a.hidden.reputation ||
    coachQuality(b) - coachQuality(a) ||
    a.id.localeCompare(b.id)
  )
}

/**
 * The pool coach an AI team would hire: the best-ranked one under its own cap, or null if none.
 * A coach the team itself fired is skipped (an owner doesn't take back the man he just let go);
 * if that leaves nobody affordable the job stays vacant, as with any empty shortlist.
 */
export function chooseCoachToHire(
  market: CoachMarket,
  teamId: string,
  rules: LeagueRules,
  finances: TeamFinances,
): HeadCoach | null {
  const fired = market.firedBy[teamId] ?? []
  const affordable = market.pool.filter(
    (c) => !fired.includes(c.id) && canTeamAffordCoach(market, teamId, c, rules, finances),
  )
  return affordable.sort(compareCandidates)[0] ?? null
}

/** An AI team fills its vacancy with its preferred affordable coach; unchanged if none fits. */
export function aiHireCoach(
  rng: Rng,
  market: CoachMarket,
  teamId: string,
  rules: LeagueRules,
  finances: TeamFinances,
): CoachMarket {
  const choice = chooseCoachToHire(market, teamId, rules, finances)
  if (choice === null) return market
  return hireCoach(market, teamId, choice.id, rules, finances, contractYears(rng, choice))
}

/** A team's win–loss record. */
export interface TeamRecord {
  wins: number
  losses: number
}

/** What an owner expects from his coach. */
export interface CoachExpectations {
  /** The win percentage the team was expected to reach (0–1). */
  expectedWinPct: number
  /** How far below expectations the coach may fall before he is fired (0–1). */
  tolerance: number
}

/** Default slack below expectations: about 12 wins over an 82-game season. */
export const DEFAULT_FIRING_TOLERANCE = 0.15

/**
 * Whether an AI owner fires the coach after a record: only if the team fell clearly short of
 * expectations. The tolerance keeps ordinary bad luck from costing a coach his job. When this runs
 * (end of season, mid-season) is up to the season loop, which doesn't exist yet.
 */
export function shouldFireCoach(record: TeamRecord, expectations: CoachExpectations): boolean {
  const games = record.wins + record.losses
  if (games === 0) return false
  return record.wins / games < expectations.expectedWinPct - expectations.tolerance
}
