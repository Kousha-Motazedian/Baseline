/** Engine invariants of rotations and fatigue over many whole games (pro, FIBA, short-handed). */
import { describe, expect, it } from 'vitest'
import { generateTeam } from '../../../src/core/data/teamGenerator.ts'
import { FULL_ENERGY, tickEnergy } from '../../../src/core/match/fatigue.ts'
import { simulateGame } from '../../../src/core/match/game.ts'
import type { MatchResult, MatchTeam } from '../../../src/core/match/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { buildRotationPlan } from '../../../src/core/tactics/rotation.ts'
import { generateSystem, SYSTEM_ARCHETYPES } from '../../../src/core/tactics/system.ts'
import type { LeagueRules } from '../../../src/core/world/rules.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { makeFlatTeam, withAttributes } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'
import { gameSeconds, mean, SLOW_TEST_TIMEOUT_MS } from '../../helpers/simulation.ts'

/** A generated league team with a random system and a random Rotation Management coach. */
function randomTeam(seed: number, id: string, rules: LeagueRules): MatchTeam {
  const rng = createRng(seed)
  const base = generateTeam(rng, { id, rules })
  const system = generateSystem(rng, rng.pick(SYSTEM_ARCHETYPES))
  const rm = 1 + Math.floor(rng.next() * 20)
  const gm = 1 + Math.floor(rng.next() * 20)
  return {
    ...base,
    coaching: { system, offensiveExecution: 0, defensiveExecution: 0 },
    rotation: buildRotationPlan(base.roster, undefined, system, undefined, rules),
    rotationCoach: { rotationManagement: rm, gameManagement: gm },
  }
}

/** Replays check-ins from the play-by-play; returns stint lengths in subs per team, or throws on a violation. */
function replay(result: MatchResult, team: MatchTeam, id: string): number {
  const byName = new Map<string, string>()
  for (const p of team.roster) byName.set(p.lastName, p.id)
  if (byName.size !== team.roster.length) return -1 // surname clash: skip
  const line = id === result.home.teamId ? result.home : result.away
  const onCourt = new Set(
    line.players.filter((l) => l.started).map((l) => l.name.split(' ').slice(-1)[0] as string),
  )
  expect(onCourt.size).toBe(5)
  const out = new Set<string>()
  let subs = 0
  for (const e of result.playByPlay) {
    if (e.teamId !== id) continue
    const swap = e.text.match(/(\S+) checks in for (\S+)/)
    const dq = e.text.match(/^(\S+) (?:fouls out|is ejected); (\S+) checks in/)
    if (swap?.[1] && swap[2]) {
      expect(onCourt.has(swap[1])).toBe(false)
      expect(out.has(swap[1])).toBe(false)
      expect(onCourt.has(swap[2])).toBe(true)
      onCourt.delete(swap[2])
      onCourt.add(swap[1])
      subs++
    } else if (dq?.[1] && dq[2]) {
      out.add(dq[1])
      expect(onCourt.delete(dq[1])).toBe(true)
      expect(onCourt.has(dq[2])).toBe(false)
      expect(out.has(dq[2])).toBe(false)
      onCourt.add(dq[2])
    }
    expect(onCourt.size).toBe(5)
  }
  return subs
}

describe('rotation invariants over many games', () => {
  for (const rules of [PRO_RULES, FIBA_RULES]) {
    it(
      `${rules.name}: minutes add up, lineups stay legal, stints are sane, seeds repeat`,
      () => {
        const stintMinutes: number[] = []
        let overtimes = 0
        for (let i = 0; i < 60; i++) {
          const home = randomTeam(1000 + i, 'home', rules)
          const away = randomTeam(5000 + i, 'away', rules)
          const result = simulateGame({ home, away, rules, seed: i })
          const length = gameSeconds(result, rules)
          if (result.periodsPlayed > rules.periods) overtimes++
          for (const side of [result.home, result.away]) {
            const total = side.players.reduce((s, l) => s + l.secondsPlayed, 0)
            // Every second has five of the team on the floor (nobody is short-handed here).
            expect(total).toBeCloseTo(length * 5, 3)
            for (const l of side.players) {
              expect(l.secondsPlayed).toBeGreaterThanOrEqual(0)
              expect(l.secondsPlayed).toBeLessThanOrEqual(length + 1e-6)
            }
          }
          for (const [res, team] of [
            [result, home],
            [result, away],
          ] as const) {
            const subs = replay(res, team, team.id)
            if (subs >= 0) stintMinutes.push((length * 5) / 60 / Math.max(1, subs + 5))
          }
          if (i % 10 === 0) {
            expect(simulateGame({ home, away, rules, seed: i })).toEqual(result)
          }
        }
        // Average stint = on-court minutes per check-in+opening slot: a few minutes, not churn.
        expect(mean(stintMinutes)).toBeGreaterThan(2.5)
        expect(mean(stintMinutes)).toBeLessThan(12)
        expect(overtimes).toBeLessThan(15)
      },
      SLOW_TEST_TIMEOUT_MS,
    )
  }

  it('short-handed FIBA teams (five players, heavy fouling) still finish games', () => {
    const rules = FIBA_RULES
    const rough = (id: string): MatchTeam => {
      const t = makeFlatTeam(id, 10, 5)
      return {
        ...t,
        roster: t.roster.map((p) => withAttributes(p, { aggression: 20, discipline: 1 })),
      }
    }
    let shortHanded = 0
    for (let seed = 0; seed < 40; seed++) {
      const result = simulateGame({ home: rough('A'), away: rough('B'), rules, seed })
      const length = gameSeconds(result, rules)
      for (const side of [result.home, result.away]) {
        const total = side.players.reduce((s, l) => s + l.secondsPlayed, 0)
        expect(total).toBeLessThanOrEqual(length * 5 + 1e-6)
        expect(total).toBeGreaterThan(length) // never below one player
      }
      if (result.playByPlay.some((e) => / play with \d/.test(e.text))) shortHanded++
    }
    expect(shortHanded).toBeGreaterThan(0)
  })

  it('energy stays within 0-100 under any on-court time', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 1, 10), away: makeFlatTeam('B', 20, 10) })
    for (const team of [game.home, game.away]) {
      for (let s = 0; s < 5000; s++) {
        tickEnergy(team, 7)
        for (const p of team.team.roster) {
          const e = team.energy.get(p.id) as number
          expect(e).toBeGreaterThanOrEqual(0)
          expect(e).toBeLessThanOrEqual(FULL_ENERGY)
        }
      }
    }
  })
})
