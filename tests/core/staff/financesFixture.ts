/**
 * Team finance fixtures for the staff tests (not a test file itself).
 */
import type { TeamFinances } from '../../../src/core/finances/teamFinances.ts'

/** Finances where every team has the same market size and owner wealth. */
export function uniformFinances(
  teamIds: readonly string[],
  rating: number,
): Record<string, TeamFinances> {
  return Object.fromEntries(
    teamIds.map((teamId) => [teamId, { teamId, marketSize: rating, ownerWealth: rating }]),
  )
}

/** Finances spread evenly from the poorest team (first id, 1/1) to the richest (last id, 20/20). */
export function spreadFinances(teamIds: readonly string[]): Record<string, TeamFinances> {
  const last = Math.max(teamIds.length - 1, 1)
  return Object.fromEntries(
    teamIds.map((teamId, i) => {
      const rating = 1 + Math.round((19 * i) / last)
      return [teamId, { teamId, marketSize: rating, ownerWealth: rating }]
    }),
  )
}

/** One team's finances at a rating (both market size and owner wealth). */
export function financesAt(teamId: string, rating: number): TeamFinances {
  return { teamId, marketSize: rating, ownerWealth: rating }
}
