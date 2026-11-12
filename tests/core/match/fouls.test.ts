import { describe, expect, it } from 'vitest'
import {
  commitFoul,
  nonShootingFoulChance,
  offensiveFoulChance,
} from '../../../src/core/match/fouls.ts'
import { disqualify } from '../../../src/core/match/lineup.ts'
import type { GameState, TeamState } from '../../../src/core/match/state.ts'
import { matchupDefender } from '../../../src/core/match/state.ts'
import { addTeamFoul, isInPenalty, resetTeamFouls } from '../../../src/core/match/teamFouls.ts'
import { assessTechnical, technicalChance } from '../../../src/core/match/technicals.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { makeFlatTeam, makePlayer, patchTeam } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'
import { expectValidResult } from '../../helpers/invariants.ts'
import { playSeries, sides, SLOW_TEST_TIMEOUT_MS, teamTotal } from '../../helpers/simulation.ts'

/** The player in a lineup slot (throws if missing, which would be a fixture bug). */
function slot(lineup: readonly Player[], index: number): Player {
  const player = lineup[index]
  if (!player) throw new Error(`no player in slot ${index}`)
  return player
}

/** Adds `count` team fouls to a team at the game's current clock. */
function foulTimes(game: GameState, team: TeamState, count: number): void {
  for (let i = 0; i < count; i++) addTeamFoul(game, team)
}

/** Total free-throw attempts by a team's live box score. */
function liveFta(team: TeamState): number {
  return [...team.lines.values()].reduce((s, l) => s + l.freeThrowsAttempted, 0)
}

describe('team fouls and the bonus (pro)', () => {
  it('penalizes the 5th foul of a quarter', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    foulTimes(game, game.home, 3)
    expect(isInPenalty(game, game.home)).toBe(false)
    foulTimes(game, game.home, 1)
    expect(isInPenalty(game, game.home)).toBe(true)
  })

  it('penalizes the 2nd foul inside the last 2:00 even under the period allowance', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      clock: 300,
    })
    foulTimes(game, game.home, 1)
    game.clock = 100
    expect(isInPenalty(game, game.home)).toBe(false)
    foulTimes(game, game.home, 1)
    expect(game.home.teamFouls).toBe(2)
    expect(isInPenalty(game, game.home)).toBe(true)
  })

  it('gives each overtime its own count, penalizing the 4th foul', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    foulTimes(game, game.home, 6)
    game.period = 5
    game.clock = 300
    resetTeamFouls(game)
    expect(game.home.teamFouls).toBe(0)
    foulTimes(game, game.home, 2)
    expect(isInPenalty(game, game.home)).toBe(false)
    foulTimes(game, game.home, 1)
    expect(isInPenalty(game, game.home)).toBe(true)
  })
})

describe('team fouls and the bonus (FIBA)', () => {
  it('penalizes every foul after 4 and has no late-window rule', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      rules: FIBA_RULES,
      clock: 60,
    })
    foulTimes(game, game.home, 3)
    expect(isInPenalty(game, game.home)).toBe(false)
    foulTimes(game, game.home, 1)
    expect(isInPenalty(game, game.home)).toBe(true)
  })

  it('carries Q4 team fouls into every overtime', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      rules: FIBA_RULES,
      period: 4,
    })
    foulTimes(game, game.home, 4)
    game.period = 5
    resetTeamFouls(game)
    expect(game.home.teamFouls).toBe(4)
    expect(isInPenalty(game, game.home)).toBe(true)
  })
})

describe('commitFoul', () => {
  it('counts every personal foul as a team foul and reports the penalty state before it', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    const player = slot(game.home.onCourt, 0)
    const penalties = Array.from({ length: 6 }, (_, i) =>
      commitFoul(game, game.home, slot(game.home.onCourt, i % 5), 'Reach-in foul'),
    )
    // Fouls 1-4 are free; the 5th and 6th shoot.
    expect(penalties).toEqual([false, false, false, false, true, true])
    expect(game.home.teamFouls).toBe(6)
    expect(game.home.lines.get(player.id)?.personalFouls).toBe(2)
  })

  it('logs the foul under the fouling team (play-by-play convention)', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    commitFoul(game, game.away, slot(game.away.onCourt, 2), 'Holding foul')
    expect(game.playByPlay[0]?.teamId).toBe('B')
    expect(game.playByPlay[0]?.text).toContain('Holding foul')
  })
})

describe('foul chances', () => {
  const avg = makePlayer({ id: 'a' })

  it('non-shooting fouls: more from aggressive, undisciplined defenders and quick, driving handlers', () => {
    const base = nonShootingFoulChance(0.08, avg, avg)
    expect(base).toBeCloseTo(0.08, 10)
    const hothead = makePlayer({ id: 'h', attributes: { aggression: 18, discipline: 4 } })
    const slasher = makePlayer({ id: 's', attributes: { driving: 18, quickness: 18 } })
    const stopper = makePlayer({ id: 'd', attributes: { perimeterDefense: 18, quickness: 18 } })
    expect(nonShootingFoulChance(0.08, avg, hothead)).toBeGreaterThan(base)
    expect(nonShootingFoulChance(0.08, slasher, avg)).toBeGreaterThan(base)
    expect(nonShootingFoulChance(0.08, avg, stopper)).toBeLessThan(base)
  })

  it('offensive fouls: reckless attackers commit more, high Defensive IQ draws more charges', () => {
    const base = offensiveFoulChance(0.03, avg, avg)
    expect(base).toBeCloseTo(0.03, 10)
    const reckless = makePlayer({ id: 'r', attributes: { aggression: 18, discipline: 4 } })
    const smart = makePlayer({ id: 'd', attributes: { defensiveIq: 19 } })
    expect(offensiveFoulChance(0.03, reckless, avg)).toBeGreaterThan(base)
    expect(offensiveFoulChance(0.03, avg, smart)).toBeGreaterThan(base)
  })
})

describe('technical fouls', () => {
  it('are likelier for low Temperament, low Discipline, tense games and foul trouble', () => {
    const home = makeFlatTeam('A', 10)
    const hothead = makePlayer({ id: 'hot', attributes: { discipline: 4 } })
    hothead.hidden.temperament = 2
    const calm = makePlayer({ id: 'calm', attributes: { discipline: 15 } })
    calm.hidden.temperament = 18
    home.roster[0] = hothead
    home.roster[1] = calm
    const game = makeGameState({ home, away: makeFlatTeam('B', 10) })
    const average = slot(game.home.onCourt, 2)
    const quiet = technicalChance(game, game.home, average)
    expect(technicalChance(game, game.home, hothead)).toBeGreaterThan(quiet)
    expect(technicalChance(game, game.home, calm)).toBeLessThan(quiet)
    const line = game.home.lines.get(average.id)
    if (!line) throw new Error('missing line')
    line.personalFouls = PRO_RULES.personalFoulLimit - 1
    const inTrouble = technicalChance(game, game.home, average)
    expect(inTrouble).toBeGreaterThan(quiet)
    game.period = 4
    game.clock = 60
    expect(technicalChance(game, game.home, average)).toBeGreaterThan(inTrouble)
  })

  it('give the opponent one free throw by its best FT shooter on the floor', () => {
    const away = makeFlatTeam('B', 10)
    away.roster[3] = makePlayer({ id: 'sniper', attributes: { freeThrow: 19 } })
    const game = makeGameState({ home: makeFlatTeam('A', 10), away })
    assessTechnical(game, game.home, slot(game.home.onCourt, 1))
    expect(game.away.lines.get('sniper')?.freeThrowsAttempted).toBe(1)
    expect(liveFta(game.away)).toBe(1)
    expect(game.home.lines.get(slot(game.home.onCourt, 1).id)?.technicalFouls).toBe(1)
  })

  it('eject a player on the second technical (pro: not counted as personal fouls)', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    const player = slot(game.home.onCourt, 1)
    assessTechnical(game, game.home, player)
    expect(game.home.onCourt).toContain(player)
    assessTechnical(game, game.home, player)
    expect(game.home.onCourt).not.toContain(player)
    expect(game.home.lines.get(player.id)?.personalFouls).toBe(0)
    expect(game.playByPlay.some((e) => e.text.includes('is ejected'))).toBe(true)
  })

  it('count toward the personal-foul limit under FIBA rules', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      rules: FIBA_RULES,
    })
    const player = slot(game.home.onCourt, 1)
    const line = game.home.lines.get(player.id)
    if (!line) throw new Error('missing line')
    line.personalFouls = FIBA_RULES.personalFoulLimit - 1
    assessTechnical(game, game.home, player)
    expect(line.personalFouls).toBe(FIBA_RULES.personalFoulLimit)
    expect(game.home.onCourt).not.toContain(player)
  })
})

describe('no-bench disqualification', () => {
  it('FIBA: the team plays on with fewer players, but never fewer than one', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10, 5),
      away: makeFlatTeam('B', 10),
      rules: FIBA_RULES,
    })
    const starters = [...game.home.onCourt]
    for (const player of starters) disqualify(game, game.home, player, 'fouledOut')
    expect(game.home.onCourt).toHaveLength(1)
    expect(game.playByPlay.some((e) => e.text.includes('play with 4'))).toBe(true)
  })

  it('wraps matchups around when the defense is short-handed', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10, 5),
      rules: FIBA_RULES,
    })
    disqualify(game, game.away, slot(game.away.onCourt, 2), 'fouledOut')
    expect(game.away.onCourt).toHaveLength(4)
    const shooter = slot(game.home.onCourt, 4)
    expect(matchupDefender(game.home, game.away, shooter)).toBe(slot(game.away.onCourt, 0))
  })

  it(
    'FIBA: an undisciplined 5-man team still finishes valid games, short-handed',
    { timeout: SLOW_TEST_TIMEOUT_MS },
    () => {
      const fiveMan = patchTeam(makeFlatTeam('F', 10.5, 5), { discipline: 1 })
      const attackers = patchTeam(makeFlatTeam('X', 10.5), { aggression: 20 })
      const results = playSeries(fiveMan, attackers, 20, { rules: FIBA_RULES })
      let shortHanded = 0
      for (const r of results) {
        expectValidResult(r, FIBA_RULES)
        if (r.playByPlay.some((e) => / play with \d$/.test(e.text))) shortHanded++
        // Fewer than five on the floor at some point means fewer than 5 full games of minutes.
        const [team] = sides(r, 'F')
        expect(teamTotal(team, 'secondsPlayed')).toBeGreaterThan(0)
      }
      expect(shortHanded).toBeGreaterThan(0)
    },
  )
})
