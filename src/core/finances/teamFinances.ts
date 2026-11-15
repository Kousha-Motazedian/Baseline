import type { Rng } from '../shared/rng.ts'
import { randomNormal } from '../shared/normal.ts'
import { clamp } from '../shared/probability.ts'
import type { LeagueRules } from '../world/rules.ts'

/**
 * A team's financial standing, each value on the 1-20 scale.
 * Owner Wealth belongs to the owner, not the franchise: when team sales arrive (3.0) a new owner
 * brings his own wealth, so a team's coach cap can rise or fall with the sale.
 */
export interface TeamFinances {
  teamId: string
  /** How big the team's market is (1-20). Belongs to the franchise. */
  marketSize: number
  /** How rich the team's owner is (1-20). Belongs to the owner. */
  ownerWealth: number
}

const MEAN = 10.5
const STANDARD_DEVIATION = 4
// Big markets tend to attract rich owners, but not always.
const MARKET_OWNER_CORRELATION = 0.3

/** Combines market size and owner wealth into one financial power value (1-20). */
export function financialPower(finances: TeamFinances): number {
  return (finances.marketSize + finances.ownerWealth) / 2
}

/** Returns the team's coaching salary cap: the league range scaled by financial power, to 1,000. */
export function teamCoachCap(finances: TeamFinances, rules: LeagueRules): number {
  const { min, max } = rules.coachCapRange
  const share = (financialPower(finances) - 1) / 19
  return Math.round((min + (max - min) * share) / 1000) * 1000
}

/** Rounds a rating draw to an integer on the 1-20 scale. */
function toScale(value: number): number {
  return clamp(Math.round(value), 1, 20)
}

/** Draws one team's market size and owner wealth as correlated normal values. */
function generateOne(rng: Rng, teamId: string): TeamFinances {
  const zMarket = randomNormal(rng, 0, 1)
  const zIndependent = randomNormal(rng, 0, 1)
  // Mixing in the market's z-score gives the owner a correlation of exactly 0.3 with the market
  // while keeping his variance at 1 (0.3^2 + (sqrt(1 - 0.3^2))^2 = 1).
  const zOwner =
    MARKET_OWNER_CORRELATION * zMarket + Math.sqrt(1 - MARKET_OWNER_CORRELATION ** 2) * zIndependent
  return {
    teamId,
    marketSize: toScale(MEAN + STANDARD_DEVIATION * zMarket),
    ownerWealth: toScale(MEAN + STANDARD_DEVIATION * zOwner),
  }
}

/** Generates finances for every team id, keyed by team id. */
export function generateTeamFinances(
  rng: Rng,
  teamIds: readonly string[],
): Record<string, TeamFinances> {
  const result: Record<string, TeamFinances> = {}
  for (const teamId of teamIds) result[teamId] = generateOne(rng, teamId)
  return result
}
