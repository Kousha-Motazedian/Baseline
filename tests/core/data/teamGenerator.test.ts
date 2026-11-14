import { describe, expect, it } from 'vitest'
import {
  AVERAGE_TEAM_CA,
  generateLeague,
  generateTeam,
  leagueTeamNames,
  pickTeamNames,
} from '../../../src/core/data/teamGenerator.ts'
import type { MatchTeam } from '../../../src/core/match/types.ts'
import { VISIBLE_ATTRIBUTE_KEYS } from '../../../src/core/players/attributes.ts'
import { POSITIONS, positionRatings, primaryPosition } from '../../../src/core/players/positions.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { FIBA_RULES } from '../../../src/core/world/rules.ts'
import { mean } from '../../helpers/simulation.ts'

/** CAs of a team's players in roster order. */
function abilities(team: MatchTeam): number[] {
  return team.roster.map((p) => p.hidden.currentAbility)
}

describe('generateTeam', () => {
  it('is deterministic for the same seed', () => {
    expect(generateTeam(createRng(9), { id: 'T' })).toEqual(generateTeam(createRng(9), { id: 'T' }))
  })

  it('builds a 15-man roster with ratings on the 1–20 scale', () => {
    const team = generateTeam(createRng(3), { id: 'T' })
    expect(team.roster).toHaveLength(15)
    for (const player of team.roster) {
      for (const key of VISIBLE_ATTRIBUTE_KEYS) {
        expect(player.attributes[key]).toBeGreaterThanOrEqual(1)
        expect(player.attributes[key]).toBeLessThanOrEqual(20)
      }
    }
  })

  it('starts one player per position in PG–C slot order (by computed primary position)', () => {
    let matches = 0
    let guardHeight = 0
    let centerHeight = 0
    const teams = 50
    for (let seed = 0; seed < teams; seed++) {
      const roster = generateTeam(createRng(seed), { id: 'T' }).roster
      roster.slice(0, 5).forEach((p, slot) => {
        if (primaryPosition(positionRatings(p)) === POSITIONS[slot]) matches++
      })
      guardHeight += roster[0]?.measurables.heightCm ?? 0
      centerHeight += roster[4]?.measurables.heightCm ?? 0
    }
    expect(matches / (teams * 5)).toBeGreaterThan(0.7)
    expect(centerHeight / teams - guardHeight / teams).toBeGreaterThan(15)
  })

  it('has a realistic CA spread: a star, starters in the 60s, a weaker bench', () => {
    const teams = Array.from({ length: 40 }, (_, i) => generateTeam(createRng(i), { id: 'T' }))
    const best = teams.map((t) => Math.max(...abilities(t)))
    const starters = teams.map((t) => mean(abilities(t).slice(0, 5)))
    const bench = teams.map((t) => mean(abilities(t).slice(5)))
    expect(Math.min(...best)).toBeGreaterThanOrEqual(69)
    expect(mean(starters)).toBeGreaterThan(62)
    expect(mean(starters)).toBeLessThan(72)
    expect(mean(bench)).toBeGreaterThan(45)
    expect(mean(bench)).toBeLessThan(57)
  })

  it('builds a uniform average team around averageCa with a weaker bench', () => {
    const teams = Array.from({ length: 40 }, (_, i) =>
      generateTeam(createRng(i), { id: 'T', averageCa: AVERAGE_TEAM_CA }),
    )
    const starters = mean(teams.flatMap((t) => abilities(t).slice(0, 5)))
    const bench = mean(teams.flatMap((t) => abilities(t).slice(5)))
    expect(Math.abs(starters - AVERAGE_TEAM_CA)).toBeLessThan(2)
    expect(starters - bench).toBeGreaterThan(8)
  })
})

describe('generateLeague', () => {
  it('generates teams with unique ids, names and player ids', () => {
    const teams = generateLeague(createRng(8), 30)
    expect(new Set(teams.map((t) => t.id)).size).toBe(30)
    expect(new Set(teams.map((t) => t.name)).size).toBe(30)
    const playerIds = teams.flatMap((t) => t.roster.map((p) => p.id))
    expect(new Set(playerIds).size).toBe(playerIds.length)
  })

  it('gives each team about three players per position', () => {
    const teams = generateLeague(createRng(4), 30)
    for (const position of POSITIONS) {
      const perTeam = teams.map(
        (t) => t.roster.filter((p) => primaryPosition(positionRatings(p)) === position).length,
      )
      // Built as exactly 3 per position; computed positions shift a few players to a neighbour.
      expect(mean(perTeam)).toBeGreaterThan(2)
      expect(mean(perTeam)).toBeLessThan(4)
    }
  })

  it("builds rosters of the league rules' size (FIBA 12)", () => {
    for (const team of generateLeague(createRng(6), 4, FIBA_RULES)) {
      expect(team.roster).toHaveLength(FIBA_RULES.rosterSize)
    }
    expect(generateTeam(createRng(6), { id: 'T', rules: FIBA_RULES }).roster).toHaveLength(12)
  })

  it('names every team even when the league outgrows the name pool', () => {
    const names = leagueTeamNames(createRng(1), 40)
    expect(new Set(names).size).toBe(40)
    expect(names[39]).toBe('Team 40')
  })

  it('works for small leagues too', () => {
    const teams = generateLeague(createRng(2), 2)
    expect(teams).toHaveLength(2)
    for (const team of teams) expect(team.roster).toHaveLength(15)
  })
})

describe('pickTeamNames', () => {
  it('picks distinct names and throws when asked for more than the pool', () => {
    const names = pickTeamNames(createRng(2), 30)
    expect(new Set(names).size).toBe(30)
    expect(() => pickTeamNames(createRng(2), 10_000)).toThrow(RangeError)
  })
})
