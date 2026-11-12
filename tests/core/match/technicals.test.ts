/**
 * Technical fouls and disqualifications: who shoots the technical free throw, when a player is
 * ejected or fouls out, how technicals count per league, and the no-bench rules.
 */
import { describe, expect, it } from 'vitest'
import { commitFoul } from '../../../src/core/match/fouls.ts'
import { disqualify } from '../../../src/core/match/lineup.ts'
import type { GameState, TeamState } from '../../../src/core/match/state.ts'
import { assessTechnical } from '../../../src/core/match/technicals.ts'
import type { MatchTeam, PlayerLine } from '../../../src/core/match/types.ts'
import type { Player } from '../../../src/core/players/types.ts'
import type { LeagueRules } from '../../../src/core/world/rules.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { makeFlatTeam, makePlayer, patchTeam } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'
import { expectValidResult } from '../../helpers/invariants.ts'
import {
  gameSeconds,
  playSeries,
  sides,
  SLOW_TEST_TIMEOUT_MS,
  teamTotal,
} from '../../helpers/simulation.ts'

/** The player in a lineup slot (throws if missing, which would be a fixture bug). */
function slot(lineup: readonly Player[], index: number): Player {
  const player = lineup[index]
  if (!player) throw new Error(`no player in slot ${index}`)
  return player
}

/** A player's live box score line (throws if missing). */
function lineOf(team: TeamState, player: Player): PlayerLine {
  const line = team.lines.get(player.id)
  if (!line) throw new Error(`no line for ${player.id}`)
  return line
}

/** Free-throw attempts by every player of a team, by player id. */
function attemptsById(team: TeamState): Record<string, number> {
  return Object.fromEntries(
    [...team.lines.values()].map((l) => [l.playerId, l.freeThrowsAttempted]),
  )
}

/** A flat game state under `rules`, with optional replacement teams. */
function state(rules: LeagueRules, home?: MatchTeam, away?: MatchTeam): GameState {
  return makeGameState({
    home: home ?? makeFlatTeam('A', 10),
    away: away ?? makeFlatTeam('B', 10),
    rules,
  })
}

describe('technical free throw shooter', () => {
  it('is the best free-throw shooter ON THE FLOOR, never a better one on the bench', () => {
    const away = makeFlatTeam('B', 10)
    away.roster[2] = makePlayer({ id: 'floorBest', attributes: { freeThrow: 16 } })
    away.roster[8] = makePlayer({ id: 'benchBest', attributes: { freeThrow: 20 } })
    const game = state(PRO_RULES, undefined, away)
    assessTechnical(game, game.home, slot(game.home.onCourt, 0))
    expect(attemptsById(game.away)).toMatchObject({ floorBest: 1, benchBest: 0 })
    // The free throw goes to the opponent of the team charged with the technical.
    expect([...game.home.lines.values()].every((l) => l.freeThrowsAttempted === 0)).toBe(true)
  })

  it('switches to the new best shooter once he checks in', () => {
    const away = makeFlatTeam('B', 10)
    away.roster[0] = makePlayer({ id: 'starter', heightCm: 191, attributes: { freeThrow: 15 } })
    away.roster[5] = makePlayer({ id: 'sub', heightCm: 191, attributes: { freeThrow: 19 } })
    const game = state(PRO_RULES, undefined, away)
    disqualify(game, game.away, slot(game.away.onCourt, 3), 'fouledOut')
    // Slot 3 (201 cm) is replaced by the closest height on the bench: slot 7 (201 cm), not the sub.
    assessTechnical(game, game.home, slot(game.home.onCourt, 0))
    expect(attemptsById(game.away)).toMatchObject({ starter: 1, sub: 0 })
    disqualify(game, game.away, slot(game.away.onCourt, 0), 'fouledOut')
    assessTechnical(game, game.home, slot(game.home.onCourt, 1))
    expect(attemptsById(game.away)).toMatchObject({ starter: 1, sub: 1 })
  })
})

describe('ejection and foul limits', () => {
  it('pro: 2 technicals eject (logged as an ejection), technicals never add personal fouls', () => {
    const game = state(PRO_RULES)
    const player = slot(game.home.onCourt, 2)
    lineOf(game.home, player).personalFouls = PRO_RULES.personalFoulLimit - 1
    assessTechnical(game, game.home, player)
    // At 5 fouls a technical does not foul a pro player out.
    expect(game.home.onCourt).toContain(player)
    expect(lineOf(game.home, player).personalFouls).toBe(PRO_RULES.personalFoulLimit - 1)
    assessTechnical(game, game.home, player)
    expect(game.home.onCourt).not.toContain(player)
    expect(game.home.disqualified.has(player.id)).toBe(true)
    const texts = game.playByPlay.map((e) => e.text)
    expect(texts.some((t) => t.includes('is ejected'))).toBe(true)
    expect(texts.some((t) => t.includes('fouls out'))).toBe(false)
  })

  it('FIBA: 2 technicals eject even with no personal fouls; each one is also a personal foul', () => {
    const game = state(FIBA_RULES)
    const player = slot(game.home.onCourt, 2)
    assessTechnical(game, game.home, player)
    assessTechnical(game, game.home, player)
    expect(lineOf(game.home, player).personalFouls).toBe(2)
    expect(lineOf(game.home, player).technicalFouls).toBe(2)
    expect(game.home.onCourt).not.toContain(player)
    expect(game.playByPlay.some((e) => e.text.includes('is ejected'))).toBe(true)
  })

  it('FIBA: a technical on the 4th personal foul is the 5th, and fouls the player out', () => {
    const game = state(FIBA_RULES)
    const player = slot(game.home.onCourt, 2)
    lineOf(game.home, player).personalFouls = FIBA_RULES.personalFoulLimit - 1
    assessTechnical(game, game.home, player)
    expect(game.home.onCourt).not.toContain(player)
    expect(game.playByPlay.some((e) => e.text.includes('fouls out'))).toBe(true)
  })

  it('a disqualified player is never picked again as a replacement', () => {
    const game = state(PRO_RULES)
    const first = slot(game.home.onCourt, 4)
    disqualify(game, game.home, first, 'fouledOut')
    const replacement = slot(game.home.onCourt, 4)
    disqualify(game, game.home, replacement, 'ejected')
    expect(game.home.onCourt).not.toContain(first)
    expect(game.home.onCourt).not.toContain(replacement)
    expect(new Set(game.home.onCourt.map((p) => p.id)).size).toBe(5)
  })
})

describe('pro no-bench rule (stays on)', () => {
  it('a disqualified player who stays on is charged a team technical, not a 7th foul', () => {
    const game = state(PRO_RULES, makeFlatTeam('A', 10, 5))
    const player = slot(game.home.onCourt, 1)
    lineOf(game.home, player).personalFouls = PRO_RULES.personalFoulLimit
    disqualify(game, game.home, player, 'fouledOut')
    expect(game.home.onCourt).toContain(player)
    const teamFoulsBefore = game.home.teamFouls
    commitFoul(game, game.home, player, 'Reach-in foul')
    expect(lineOf(game.home, player).personalFouls).toBe(PRO_RULES.personalFoulLimit)
    expect(lineOf(game.home, player).technicalFouls).toBe(0)
    // Still a team foul, plus one free throw for the opponent.
    expect(game.home.teamFouls).toBe(teamFoulsBefore + 1)
    const awayAttempts = Object.values(attemptsById(game.away)).reduce((s, n) => s + n, 0)
    expect(awayAttempts).toBe(1)
    expect(game.playByPlay.some((e) => e.text.includes('already disqualified'))).toBe(true)
  })
})

/** Rules that make players foul out after 2 fouls, so a game runs out of players fast. */
function quickFoulOut(rules: LeagueRules): LeagueRules {
  return { ...rules, name: `${rules.name} (2-foul limit)`, personalFoulLimit: 2 }
}

/** A 5-man team that fouls constantly, against an aggressive full team. */
function foulTrap(): [MatchTeam, MatchTeam] {
  const fiveMan = patchTeam(makeFlatTeam('F', 10.5, 5), { discipline: 1, aggression: 20 })
  const attackers = patchTeam(makeFlatTeam('X', 10.5), { aggression: 20 })
  return [fiveMan, attackers]
}

/** Smallest lineup size announced in "<team> play with N" lines (5 if none). */
function smallestLineup(texts: readonly string[]): number {
  const sizes = texts.map((t) => / play with (\d+)$/.exec(t)?.[1]).filter((n) => n !== undefined)
  return Math.min(5, ...sizes.map(Number))
}

describe('running out of players', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('FIBA: plays down to one player, never zero, and the game stays valid', () => {
    const rules = quickFoulOut(FIBA_RULES)
    const [fiveMan, attackers] = foulTrap()
    let reachedOne = 0
    for (const result of playSeries(fiveMan, attackers, 15, { rules })) {
      expectValidResult(result, rules)
      const texts = result.playByPlay.filter((e) => e.teamId === 'F').map((e) => e.text)
      const smallest = smallestLineup(texts)
      expect(smallest).toBeGreaterThanOrEqual(1)
      if (smallest === 1) reachedOne++
      // With at least one player always on, the team logs at least one game's worth of minutes.
      const [team] = sides(result, 'F')
      expect(teamTotal(team, 'secondsPlayed')).toBeGreaterThanOrEqual(
        gameSeconds(result, rules) - 1e-6,
      )
    }
    expect(reachedOne).toBeGreaterThan(0)
  })

  it('pro: keeps five on the floor, caps personal fouls and gives a free throw per extra foul', () => {
    const rules = quickFoulOut(PRO_RULES)
    const [fiveMan, attackers] = foulTrap()
    let teamTechnicals = 0
    for (const result of playSeries(fiveMan, attackers, 10, { rules })) {
      expectValidResult(result, rules)
      result.playByPlay.forEach((entry, i) => {
        if (!entry.text.includes('already disqualified')) return
        teamTechnicals++
        const next = result.playByPlay[i + 1]
        expect(next?.text).toMatch(/technical free throw$/)
        expect(next?.teamId).not.toBe(entry.teamId)
      })
    }
    expect(teamTechnicals).toBeGreaterThan(10)
  })
})
