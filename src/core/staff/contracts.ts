import { ATTRIBUTE_MAX, ATTRIBUTE_MIN } from '../players/attributes.ts'
import { clamp } from '../shared/probability.ts'
import type { Rng } from '../shared/rng.ts'
import type { LeagueRules } from '../world/rules.ts'
import { coachQuality, REPUTATION_MAX } from './coachGenerator.ts'
import type { CoachContract, HeadCoach } from './types.ts'

/**
 * Coach contracts and the coach cap (docs/design/coaches.md, section 6). A coach's salary demand
 * blends his Reputation (70%) and his real ability (30%). The league pays mostly for perception, so
 * a famous coach is expensive whatever his attributes; but ability still counts, so a good coach
 * with a low reputation is a bargain without being available at the minimum price. Demands are the
 * same for every team; what differs is each team's own coach cap (see teamCoachCap).
 */

/** Shortest and longest coach contracts, in seasons. */
export const MIN_CONTRACT_YEARS = 1
export const MAX_CONTRACT_YEARS = 5

/**
 * The cheapest coach's salary as a share of the top of the cap range. A tenth of it (USD 1.5M in
 * the pro league) matches the low end of real head-coach pay.
 */
const SALARY_FLOOR_SHARE = 0.1
/**
 * Curve of salary over value. Squared, because coaching pay is top-heavy: a handful of famous
 * coaches earn several times the typical salary.
 */
const SALARY_CURVE_EXPONENT = 2
/**
 * Weight of reputation in a coach's value; the rest is his attribute mean. Reputation dominates
 * because the league pays for perception, but ability keeps a real share so underrated coaches
 * are cheap, not free.
 */
const REPUTATION_WEIGHT = 0.7
/** Salaries are rounded to this many currency units, like real contract figures. */
const SALARY_ROUNDING = 1_000

/** Coaches this old or older only sign short deals (they are near retirement). */
const VETERAN_AGE = 65
const VETERAN_MAX_YEARS = 2
/** Coaches with at least this reputation won't take a one-year deal: they have options. */
const ESTABLISHED_REPUTATION = 60

/**
 * The per-season salary a coach asks for: value = 0.7 x reputation share + 0.3 x attribute-mean
 * share, demand = top of the cap range x (0.1 + 0.9 x value^2). Never above the top of the range,
 * so the richest team can always afford even the best coach. Record-based demands come later.
 */
export function salaryDemand(coach: HeadCoach, rules: LeagueRules): number {
  const reputation = clamp(coach.hidden.reputation / REPUTATION_MAX, 0, 1)
  const ability = clamp(
    (coachQuality(coach) - ATTRIBUTE_MIN) / (ATTRIBUTE_MAX - ATTRIBUTE_MIN),
    0,
    1,
  )
  const value = REPUTATION_WEIGHT * reputation + (1 - REPUTATION_WEIGHT) * ability
  const top = rules.coachCapRange.max
  const raw = top * (SALARY_FLOOR_SHARE + (1 - SALARY_FLOOR_SHARE) * value ** SALARY_CURVE_EXPONENT)
  const rounded = Math.round(raw / SALARY_ROUNDING) * SALARY_ROUNDING
  return Math.min(rounded, top)
}

/**
 * The range of contract lengths a coach asks for, by age and reputation. Only AI hiring and league
 * setup stick to it; the GM's hireCoach may offer any valid length (see coaches.md).
 */
export function contractYearsRange(coach: HeadCoach): { min: number; max: number } {
  const max = coach.age >= VETERAN_AGE ? VETERAN_MAX_YEARS : MAX_CONTRACT_YEARS
  const min = coach.hidden.reputation >= ESTABLISHED_REPUTATION ? 2 : MIN_CONTRACT_YEARS
  return { min: Math.min(min, max), max }
}

/** A random contract length (in seasons) within the coach's own range (AI hiring, league setup). */
export function contractYears(rng: Rng, coach: HeadCoach): number {
  const range = contractYearsRange(coach)
  return rng.nextInt(range.min, range.max)
}

/** True if a contract length is a whole number of seasons in the 1–5 band. */
export function isValidContractLength(years: number): boolean {
  return Number.isInteger(years) && years >= MIN_CONTRACT_YEARS && years <= MAX_CONTRACT_YEARS
}

/** The contract a coach signs at his salary demand for the given length. */
export function offerContract(coach: HeadCoach, rules: LeagueRules, years: number): CoachContract {
  if (!isValidContractLength(years)) {
    throw new RangeError(`offerContract: ${years} is not a valid contract length (1–5 seasons)`)
  }
  return { salary: salaryDemand(coach, rules), yearsRemaining: years }
}

/**
 * Coaching salaries a team is committed to this season. Only its current head coach counts.
 * Firing is free for now: a fired coach's remaining salary does NOT count against the coach cap.
 * That changes with full team finances (docs/TODO.md, "Full team finances"), where a fired coach
 * keeps being paid until his contract ends.
 */
export function coachSpending(headCoach: HeadCoach | undefined): number {
  return headCoach?.contract?.salary ?? 0
}

/** True if a team spending `currentSpending` can add a coach on `salary` without passing its cap. */
export function canAffordCoach(currentSpending: number, salary: number, cap: number): boolean {
  return currentSpending + salary <= cap
}
