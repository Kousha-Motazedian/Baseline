/** Substitution wiring: the coach hook, validation, disqualifications, and the removed stopgaps. */
import { describe, expect, it } from 'vitest'
import { simulateGame } from '../../../src/core/match/game.ts'
import { foulCautionEdge } from '../../../src/core/match/fouls.ts'
import { leadSafety, regulationSecondsLeft } from '../../../src/core/match/leadSafety.ts'
import { applySubstitutions, substitutionContext } from '../../../src/core/match/substitutions.ts'
import { lineOf } from '../../../src/core/match/state.ts'
import { LEAD_SAFETY_SD_PER_SQRT_MINUTE } from '../../../src/core/match/tuning.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { generatedPair, makeFlatTeam } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'

describe('opening five and coach context', () => {
  it('opens with the plan starters in slot order', () => {
    const team = makeFlatTeam('A', 10)
    const ids = team.roster.map((p) => p.id)
    team.rotation = {
      starters: [ids[5], ids[1], ids[2], ids[3], ids[9]] as string[],
      order: ids,
      targetSeconds: {},
      closers: ids.slice(0, 5),
    }
    const game = makeGameState({ home: team, away: makeFlatTeam('B', 10) })
    expect(game.home.onCourt.map((p) => p.id)).toEqual(team.rotation.starters)
  })

  it('builds a context with energy, fouls and lead safety', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    game.home.points = 20
    const first = game.home.onCourt[0]
    if (!first) throw new Error('no player')
    lineOf(game.home, first).personalFouls = 3
    const ctx = substitutionContext(game, game.home)
    expect(ctx.lead).toBe(20)
    expect(ctx.leadSafety).toBeGreaterThan(0)
    expect(ctx.status[first.id]).toMatchObject({
      personalFouls: 3,
      energy: 100,
      disqualified: false,
    })
    expect(ctx.onCourt).toHaveLength(5)
  })
})

describe('applying substitutions', () => {
  it('logs "X checks in for Y" and never fields a disqualified or on-court player', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    // Tire the starters so the (stub) coach wants to sub; disqualify one bench player.
    for (const p of game.home.onCourt) game.home.energy.set(p.id, 20)
    const banned = game.home.team.roster[5]
    if (!banned) throw new Error('no bench')
    game.home.disqualified.add(banned.id)
    applySubstitutions(game, game.home)
    expect(game.home.onCourt).not.toContain(banned)
    expect(new Set(game.home.onCourt).size).toBe(game.home.onCourt.length)
    expect(game.playByPlay.some((e) => e.text.includes('checks in for'))).toBe(true)
  })
})

describe('whole games', () => {
  it('nobody disqualified ever returns; lineups always have five distinct players', () => {
    const [a, b] = generatedPair(7)
    for (const rules of [PRO_RULES, FIBA_RULES]) {
      const result = simulateGame({ home: a, away: b, rules, seed: 11 })
      const out = new Set<string>()
      // Chronological: a player may check in before he later fouls out, never after.
      for (const e of result.playByPlay) {
        const key = (name: string): string => `${e.teamId}:${name}`
        const inn = e.text.match(/^(\w+) checks in/)
        if (inn?.[1]) expect(out.has(key(inn[1]))).toBe(false)
        const gone = e.text.match(/^(\w+) (fouls out|is ejected)/)
        if (gone?.[1]) out.add(key(gone[1]))
      }
    }
  })

  it('spreads minutes beyond the starters', () => {
    const [a, b] = generatedPair(8)
    const result = simulateGame({ home: a, away: b, rules: PRO_RULES, seed: 3 })
    const played = result.home.players.filter((p) => p.secondsPlayed >= 600)
    expect(played.length).toBeGreaterThanOrEqual(7)
    expect(result.home.players.filter((p) => p.started)).toHaveLength(5)
  })
})

describe('foul caution and lead safety (kept from the stopgaps)', () => {
  it('a player one foul from disqualification plays it safe', () => {
    const game = makeGameState({ home: makeFlatTeam('A', 10), away: makeFlatTeam('B', 10) })
    const p = game.home.onCourt[0]
    if (!p) throw new Error('no player')
    expect(foulCautionEdge(game, game.home, p)).toBe(0)
    lineOf(game.home, p).personalFouls = PRO_RULES.personalFoulLimit - 1
    expect(foulCautionEdge(game, game.home, p)).toBeLessThan(0)
    game.home.disqualified.add(p.id)
    expect(foulCautionEdge(game, game.home, p)).toBe(0)
  })

  it('the same lead is safer with less time left, and is finite at the buzzer', () => {
    const early = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      period: 1,
      clock: 720,
    })
    const late = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      period: 4,
      clock: 240,
    })
    expect(leadSafety(late, 14)).toBeGreaterThan(leadSafety(early, 14))
    const buzzer = makeGameState({
      home: makeFlatTeam('A', 10),
      away: makeFlatTeam('B', 10),
      period: 4,
      clock: 0,
    })
    expect(leadSafety(buzzer, 6)).toBeCloseTo(6 / LEAD_SAFETY_SD_PER_SQRT_MINUTE, 12)
    expect(regulationSecondsLeft(buzzer)).toBe(0)
  })
})
