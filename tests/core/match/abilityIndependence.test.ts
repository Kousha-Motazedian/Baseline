import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateLeague } from '../../../src/core/data/teamGenerator.ts'
import { simulateGame } from '../../../src/core/match/game.ts'
import type { MatchTeam } from '../../../src/core/match/types.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { buildRotationPlan } from '../../../src/core/tactics/rotation.ts'
import { BALANCED_SYSTEM } from '../../../src/core/tactics/system.ts'
import { PRO_RULES } from '../../../src/core/world/rules.ts'

/**
 * Key principle (docs/design/player-roles.md): Current Ability, Potential, positions and roles never
 * affect how a player simulates. The engine works from attributes only.
 */

/**
 * The team with its rotation pinned to the plan its real roster produces. The head coach is
 * allowed to read CA (reputation) when choosing minutes (rotations.md section 2), so the CA
 * rule is "same lineups and minutes, same game": the tests below pin the plan and then change
 * only CA/Potential, which proves the SIMULATION never reads them.
 */
function pinned(team: MatchTeam): MatchTeam {
  return { ...team, rotation: buildRotationPlan(team.roster, undefined, BALANCED_SYSTEM) }
}

/** A copy of a team whose players' hidden CA and Potential are replaced, attributes untouched. */
function withAbility(team: MatchTeam, ca: (p: Player, i: number) => number): MatchTeam {
  return {
    ...team,
    roster: team.roster.map((p, i) => ({
      ...p,
      hidden: { ...p.hidden, currentAbility: ca(p, i), potential: 101 - ca(p, i) },
    })),
  }
}

/** All .ts files under a directory, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('Current Ability never affects the simulation', () => {
  it('plays the identical game when only hidden CA and Potential change', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const [home, away] = generateLeague(createRng(seed), 2) as [MatchTeam, MatchTeam]
      const pinnedHome = pinned(home)
      const pinnedAway = pinned(away)
      const base = simulateGame({ home: pinnedHome, away: pinnedAway, rules: PRO_RULES, seed })
      // Invert and flatten CA/PA: stars become scrubs on paper and vice versa. The plan stays.
      const inverted = simulateGame({
        home: {
          ...withAbility(home, (p) => 101 - p.hidden.currentAbility),
          rotation: pinnedHome.rotation,
        },
        away: { ...withAbility(away, () => 1), rotation: pinnedAway.rotation },
        rules: PRO_RULES,
        seed,
      })
      expect(inverted).toEqual(base)
    }
  })

  it('has no match-engine code that reads CA, Potential, positions or roles', () => {
    const matchDir = fileURLToPath(new URL('../../../src/core/match', import.meta.url))
    const forbidden = [
      /currentAbility/,
      /\bpotential\b/,
      /players\/(currentAbility|positions|roles)/,
      /data\/leagueTalent/,
    ]
    for (const file of sourceFiles(matchDir)) {
      const text = readFileSync(file, 'utf8')
      for (const pattern of forbidden) {
        expect({ file, match: pattern.test(text) }).toEqual({ file, match: false })
      }
    }
  })
})
