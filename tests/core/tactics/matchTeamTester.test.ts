/** Tester checks for the coach bridge and garbage-time behaviour (rotations review fixes M1/M2). */
import { describe, expect, it } from 'vitest'
import { generateLeague, generateTeam } from '../../../src/core/data/teamGenerator.ts'
import { simulateGame } from '../../../src/core/match/game.ts'
import type { MatchTeam } from '../../../src/core/match/types.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { generateCoach } from '../../../src/core/staff/coachGenerator.ts'
import { matchTeamFor } from '../../../src/core/tactics/matchTeam.ts'
import { PRO_RULES } from '../../../src/core/world/rules.ts'

/** A coached team whose players have unique last names, so play-by-play lines are unambiguous. */
function coachedTeam(rng: ReturnType<typeof createRng>, id: string, coachSeed: number): MatchTeam {
  const team = generateTeam(rng, { id })
  const roster = team.roster.map((p, k) => ({ ...p, lastName: `${id}${k}` }))
  return matchTeamFor(
    { ...team, roster },
    { coach: generateCoach(createRng(coachSeed), { id: `c${id}${coachSeed}` }) },
  )
}

describe('coached games: Current Ability stays out of the simulation', () => {
  it('same coach, same plan, only CA/Potential changed: identical game', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const [h, a] = generateLeague(createRng(seed), 2) as [MatchTeam, MatchTeam]
      const home = matchTeamFor(h, { coach: generateCoach(createRng(seed), { id: 'x' }) })
      const away = matchTeamFor(a, { coach: generateCoach(createRng(seed + 9), { id: 'y' }) })
      const flip = (t: MatchTeam): MatchTeam => ({
        ...t,
        roster: t.roster.map((p) => ({
          ...p,
          hidden: { ...p.hidden, currentAbility: 101 - p.hidden.currentAbility, potential: 1 },
        })),
      })
      const base = simulateGame({ home, away, rules: PRO_RULES, seed })
      const changed = simulateGame({ home: flip(home), away: flip(away), rules: PRO_RULES, seed })
      expect(changed).toEqual(base)
    }
  })
})

describe('garbage time with real coaches', () => {
  /** Games between coached teams; per team-game, counts quick swap-backs and idle-player minutes. */
  function measure(games: number): { reversalsPerGarbageGame: number; idleCloseMinutes: number } {
    let reversals = 0
    let garbageGames = 0
    let idleSeconds = 0
    let closeTeamGames = 0
    for (let i = 0; i < games; i++) {
      const rng = createRng(1000 + i)
      const home = coachedTeam(rng, 'H', 77 + i * 2)
      const away = coachedTeam(rng, 'A', 78 + i * 2)
      const r = simulateGame({ home, away, rules: PRO_RULES, seed: i + 5 })
      const margin = Math.abs(r.home.points - r.away.points)
      for (const [team, res] of [
        [home, r.home],
        [away, r.away],
      ] as const) {
        const subs = r.playByPlay.filter(
          (e) => e.teamId === team.id && e.text.includes(' checks in for '),
        )
        if (margin >= 15) garbageGames++
        for (let a = 0; a < subs.length; a++) {
          const sa = subs[a] as (typeof subs)[number]
          const [x, y] = sa.text.split(' checks in for ')
          const lead = Math.abs(sa.homeScore - sa.awayScore)
          if (sa.period !== 4 || lead < 10) continue
          // Swap-back: the player just replaced returns for the same man within 60 seconds.
          const back = subs
            .slice(a + 1)
            .find(
              (sb) =>
                sb.period === sa.period &&
                sa.clockSeconds - sb.clockSeconds <= 60 &&
                sb.text === `${y} checks in for ${x}`,
            )
          if (back) reversals++
        }
        if (margin < 10) {
          closeTeamGames++
          for (const line of res.players) {
            if ((team.rotation?.targetSeconds[line.playerId] ?? 0) === 0)
              idleSeconds += line.secondsPlayed
          }
        }
      }
    }
    return {
      reversalsPerGarbageGame: reversals / Math.max(1, garbageGames),
      idleCloseMinutes: idleSeconds / 60 / Math.max(1, closeTeamGames),
    }
  }

  const result = measure(120)

  it('players the plan gives 0 minutes play at most 2 minutes per team-game in close games', () => {
    expect(result.idleCloseMinutes).toBeLessThanOrEqual(2)
  })

  // Regression check for the tester's swap-back report: before the "decided" state got hysteresis
  // (GARBAGE_DECIDED_EXIT_FACTOR) and the garbage-time bench incumbent bonus, a lead hovering near
  // the line swapped whole lineups in and out (~4 swap-backs per team-game in 15+ point games).
  it('does not swap a bench player back out within a minute in garbage time', () => {
    expect(result.reversalsPerGarbageGame).toBeLessThan(1)
  })
})
