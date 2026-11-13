/**
 * STOPGAP blowout easing: when it applies, that it ramps smoothly with lead size and time left,
 * and that it reaches every personal edge of the leading team at both ends of the floor.
 */
import { describe, expect, it } from 'vitest'
import { easeOffEdge, leadSafety, regulationSecondsLeft } from '../../../src/core/match/blowout.ts'
import { personalEdge } from '../../../src/core/match/situation.ts'
import type { GameState } from '../../../src/core/match/state.ts'
import {
  BLOWOUT_FULL_LEAD,
  BLOWOUT_MARGIN_SD_PER_SQRT_MINUTE,
  BLOWOUT_MAX_EASE,
  BLOWOUT_START_LEAD,
  BLOWOUT_START_SAFETY,
} from '../../../src/core/match/tuning.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { makeFlatTeam } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'

/** A flat, form-free game with the home team leading by `lead` at the given moment. */
function gameAt(period: number, clock: number, lead: number): GameState {
  const game = makeGameState({
    home: makeFlatTeam('A', 10.5),
    away: makeFlatTeam('B', 10.5),
    period,
    clock,
    form: 0,
  })
  game.home.points = 80 + lead
  game.away.points = 80
  return game
}

/** The player in a lineup slot (throws if missing). */
function slot(lineup: readonly Player[], index: number): Player {
  const player = lineup[index]
  if (!player) throw new Error(`no player in slot ${index}`)
  return player
}

describe('blowout easing', () => {
  it('counts the regulation time left and never applies in the first half or overtime', () => {
    expect(regulationSecondsLeft(gameAt(3, 600, 0))).toBe(600 + 720)
    expect(easeOffEdge(gameAt(2, 60, 40), gameAt(2, 60, 40).home)).toBe(0)
    const overtime = gameAt(5, 60, 30)
    expect(easeOffEdge(overtime, overtime.home)).toBe(0)
  })

  it('only the leading team eases off', () => {
    const game = gameAt(4, 300, 25)
    expect(easeOffEdge(game, game.home)).toBeLessThan(0)
    expect(easeOffEdge(game, game.away)).toBe(0)
  })

  it('grows smoothly with the lead and as time runs out, up to the maximum', () => {
    const byLead = [6, 8, 10, 12, 14, 16, 18, 22].map((lead) => {
      const game = gameAt(4, 240, lead)
      return easeOffEdge(game, game.home)
    })
    for (let i = 1; i < byLead.length; i++) {
      expect(byLead[i]).toBeLessThanOrEqual(byLead[i - 1] as number)
      // No cliff: neighbouring leads differ by well under half the maximum.
      expect((byLead[i - 1] as number) - (byLead[i] as number)).toBeLessThan(BLOWOUT_MAX_EASE / 2)
    }
    expect(byLead.at(-1)).toBeCloseTo(-BLOWOUT_MAX_EASE, 10)
    const early = gameAt(3, 700, 14)
    const late = gameAt(4, 120, 14)
    expect(leadSafety(late, 14)).toBeGreaterThan(leadSafety(early, 14))
    expect(easeOffEdge(late, late.home)).toBeLessThan(easeOffEdge(early, early.home))
  })

  it('reaches the leading team’s personal edge at both ends of the floor', () => {
    const game = gameAt(4, 120, 25)
    const player = slot(game.home.onCourt, 0)
    const ease = easeOffEdge(game, game.home)
    // Home team: no road penalty; flat form 0; not clutch (25-point lead).
    expect(personalEdge(game, game.home, player, 'offense')).toBeCloseTo(ease, 12)
    expect(personalEdge(game, game.home, player, 'defense')).toBeCloseTo(ease, 12)
  })
})

describe('blowout ramp edges (tester round 3)', () => {
  it('is exactly zero (not −0) at the starting lead and below the starting safety', () => {
    const atStart = gameAt(4, 30, BLOWOUT_START_LEAD)
    expect(Object.is(easeOffEdge(atStart, atStart.home), 0)).toBe(true)
    // With a 0.5 start the safety ramp only bites on long games: 20-minute quarters, start of Q3
    // (40 minutes left), up 5: safety 5 / (2·√40) ≈ 0.40 < 0.5, so it must be off.
    const longGame = makeGameState({
      home: makeFlatTeam('A', 10.5),
      away: makeFlatTeam('B', 10.5),
      rules: { ...PRO_RULES, name: 'Long', periodSeconds: 20 * 60 },
      period: 3,
      clock: 20 * 60,
      form: 0,
    })
    longGame.home.points = 85
    longGame.away.points = 80
    expect(leadSafety(longGame, 5)).toBeLessThan(BLOWOUT_START_SAFETY)
    expect(Object.is(easeOffEdge(longGame, longGame.home), 0)).toBe(true)
  })

  it('reaches the full ease at a full-size, fully safe lead and never exceeds it', () => {
    const decided = gameAt(4, 60, BLOWOUT_FULL_LEAD)
    expect(easeOffEdge(decided, decided.home)).toBeCloseTo(-BLOWOUT_MAX_EASE, 12)
    const huge = gameAt(4, 10, 60)
    expect(easeOffEdge(huge, huge.home)).toBeCloseTo(-BLOWOUT_MAX_EASE, 12)
  })

  it('floors the time left at one minute (no division by zero at the buzzer)', () => {
    const buzzer = gameAt(4, 0, 6)
    expect(leadSafety(buzzer, 6)).toBeCloseTo(6 / BLOWOUT_MARGIN_SD_PER_SQRT_MINUTE, 12)
    expect(Number.isFinite(easeOffEdge(buzzer, buzzer.home))).toBe(true)
  })

  it('starts at the beginning of Q3 (second half) for a big enough lead', () => {
    const q3 = gameAt(3, 720, 30)
    expect(easeOffEdge(q3, q3.home)).toBeLessThan(0)
  })

  it('a FIBA game (10-minute quarters) measures safety on its own clock', () => {
    const game = makeGameState({
      home: makeFlatTeam('A', 10.5),
      away: makeFlatTeam('B', 10.5),
      rules: FIBA_RULES,
      period: 3,
      clock: 600,
      form: 0,
    })
    expect(regulationSecondsLeft(game)).toBe(1200)
  })
})
