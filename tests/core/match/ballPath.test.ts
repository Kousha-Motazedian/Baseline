/**
 * Ball path and bookkeeping: assists only to the actual passer, turnovers and steals charged per
 * phase, putbacks, fast-break and points-off-turnover stats, and the play-by-play convention
 * (chronological order, teamId = the team that performed the action) across whole games.
 */
import { describe, expect, it } from 'vitest'
import { findContesters } from '../../../src/core/match/contest.ts'
import type { PossessionStart } from '../../../src/core/match/possession.ts'
import { simulatePossession } from '../../../src/core/match/possession.ts'
import { resolveShot } from '../../../src/core/match/shot.ts'
import type { GameState, TeamState } from '../../../src/core/match/state.ts'
import { offensiveFoulTurnover, tryShooterTurnover } from '../../../src/core/match/turnover.ts'
import type { MatchResult, MatchTeam, PlayType } from '../../../src/core/match/types.ts'
import type { Player } from '../../../src/core/players/types.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { generatedPair, makeFlatTeam } from '../../helpers/fixtures.ts'
import { makeGameState } from '../../helpers/gameState.ts'
import { expectValidResult } from '../../helpers/invariants.ts'
import { attributedName, lastNameOwners, withUniqueNames } from '../../helpers/playByPlay.ts'
import { playSeries, SLOW_TEST_TIMEOUT_MS } from '../../helpers/simulation.ts'

/** The player in a lineup slot (throws if missing, which would be a fixture bug). */
function slot(lineup: readonly Player[], index: number): Player {
  const player = lineup[index]
  if (!player) throw new Error(`no player in slot ${index}`)
  return player
}

/** Sums one numeric box score field across a live team, by player id. */
function byPlayer(team: TeamState, field: 'assists' | 'turnovers' | 'steals'): Map<string, number> {
  return new Map([...team.lines.values()].map((l) => [l.playerId, l[field]]))
}

/** Total of one field over a live team. */
function total(team: TeamState, field: 'assists' | 'turnovers' | 'steals'): number {
  return [...byPlayer(team, field).values()].reduce((s, n) => s + n, 0)
}

/** A fresh game between two flat average teams, form fixed at 0. */
function flatGame(seed = 1): GameState {
  return makeGameState({
    home: makeFlatTeam('A', 10.5),
    away: makeFlatTeam('B', 10.5),
    form: 0,
    seed,
  })
}

/** Resolves `count` shots by `shooter` with an optional passer; returns the made field goals. */
function shoot(
  game: GameState,
  shooter: Player,
  playType: PlayType,
  count: number,
  passer?: Player,
) {
  const contesters = findContesters(game.home, game.away, shooter)
  for (let i = 0; i < count; i++) {
    resolveShot({
      game,
      offense: game.home,
      defense: game.away,
      shooter,
      contesters,
      playType,
      passer,
    })
  }
  return [...game.home.lines.values()].reduce((s, l) => s + l.fieldGoalsMade, 0)
}

describe('assists', () => {
  it('are never credited without a pass (own shot or putback)', () => {
    const game = flatGame()
    const shooter = slot(game.home.onCourt, 0)
    const made = shoot(game, shooter, 'three', 300) + shoot(game, shooter, 'putback', 300)
    expect(made).toBeGreaterThan(100)
    expect(total(game.home, 'assists')).toBe(0)
  })

  it('go only to the passer, never to the shooter or a bystander', () => {
    const game = flatGame()
    const shooter = slot(game.home.onCourt, 3)
    const passer = slot(game.home.onCourt, 0)
    const made = shoot(game, shooter, 'three', 400, passer)
    const assists = byPlayer(game.home, 'assists')
    expect(assists.get(passer.id)).toBeGreaterThan(0.8 * made)
    expect(assists.get(passer.id)).toBeLessThanOrEqual(made)
    expect(total(game.home, 'assists')).toBe(assists.get(passer.id))
  })

  it('putbacks are never assisted, even when a passer is (wrongly) supplied', () => {
    const game = flatGame()
    const made = shoot(game, slot(game.home.onCourt, 4), 'putback', 300, slot(game.home.onCourt, 0))
    expect(made).toBeGreaterThan(50)
    expect(total(game.home, 'assists')).toBe(0)
  })
})

describe('turnovers by phase', () => {
  it('shooter phase: the shooter is charged, only his own defender can steal it', () => {
    const game = flatGame()
    const shooter = slot(game.home.onCourt, 4)
    const defender = slot(game.away.onCourt, 4)
    for (let i = 0; i < 2_000; i++) {
      tryShooterTurnover(game, game.home, game.away, shooter, defender, 'postUp', true)
    }
    const turnovers = byPlayer(game.home, 'turnovers')
    expect(turnovers.get(shooter.id)).toBeGreaterThan(50)
    expect(total(game.home, 'turnovers')).toBe(turnovers.get(shooter.id))
    const steals = byPlayer(game.away, 'steals')
    expect(steals.get(defender.id)).toBeGreaterThan(0)
    expect(total(game.away, 'steals')).toBe(steals.get(defender.id))
    // Roughly half of shooter-phase turnovers are steals (travels and fumbles out of bounds aren't).
    expect(total(game.away, 'steals') / total(game.home, 'turnovers')).toBeGreaterThan(0.3)
    expect(total(game.away, 'steals') / total(game.home, 'turnovers')).toBeLessThan(0.7)
  })

  it('offensive foul: a turnover for the fouler, never a steal, no fast break', () => {
    const game = flatGame()
    const outcome = offensiveFoulTurnover(game, game.home, slot(game.home.onCourt, 1))
    expect(outcome).toEqual({ over: true, turnover: true, fastBreak: undefined })
    expect(total(game.home, 'turnovers')).toBe(1)
    expect(total(game.away, 'steals')).toBe(0)
  })
})

/** Points, fast-break points and points off turnovers the home offense gains in one possession. */
function possessionDeltas(start: PossessionStart | 'fastBreak', seed: number) {
  const game = flatGame(seed)
  const begin =
    start === 'fastBreak' ? { fastBreak: slot(game.home.onCourt, 0), afterTurnover: true } : start
  simulatePossession(game, game.home, game.away, begin)
  return {
    points: game.home.points,
    fastBreak: game.home.fastBreakPoints,
    offTurnovers: game.home.pointsOffTurnovers,
  }
}

describe('fast-break points and points off turnovers', () => {
  it('a fast break after a steal: all its points are off a turnover, fast-break points ≤ points', () => {
    let fastBreakTotal = 0
    for (let seed = 0; seed < 500; seed++) {
      const d = possessionDeltas('fastBreak', seed)
      expect(d.offTurnovers).toBe(d.points)
      expect(d.fastBreak).toBeLessThanOrEqual(d.points)
      fastBreakTotal += d.fastBreak
    }
    // Transition looks score well over a point per trip.
    expect(fastBreakTotal / 500).toBeGreaterThan(1.1)
  })

  it('a half-court possession after a turnover counts its points off turnovers, but not as fast break', () => {
    for (let seed = 0; seed < 200; seed++) {
      const d = possessionDeltas({ fastBreak: undefined, afterTurnover: true }, seed)
      expect(d.fastBreak).toBe(0)
      expect(d.offTurnovers).toBe(d.points)
      const plain = possessionDeltas({ fastBreak: undefined, afterTurnover: false }, seed)
      expect(plain.offTurnovers).toBe(0)
    }
  })
})

/** Generated teams with distinct last names, so every play-by-play line can be attributed. */
const [HOME, AWAY] = generatedPair(77).map(withUniqueNames) as [MatchTeam, MatchTeam]
/** How many of the shared games are played under pro rules (the rest are FIBA). */
const PRO_GAMES = 30
/** Shared games for the play-by-play checks (pro and FIBA). */
const GAMES: MatchResult[] = [
  ...playSeries(HOME, AWAY, PRO_GAMES),
  ...playSeries(HOME, AWAY, 15, { rules: FIBA_RULES }),
]

/** True for a field-goal line ("X makes|misses <shot>"), as opposed to a free throw. */
function isFieldGoal(text: string): boolean {
  return / (makes|misses) /.test(text) && !/free throw/.test(text)
}

describe('play-by-play convention across games', { timeout: SLOW_TEST_TIMEOUT_MS }, () => {
  it('attributes nearly every line to the team of the player it names', () => {
    let attributed = 0
    for (const r of GAMES) {
      const owners = lastNameOwners(r)
      for (const entry of r.playByPlay) {
        const name = attributedName(entry.text)
        if (name === undefined) continue
        expect(owners.get(name), entry.text).toBe(entry.teamId)
        attributed++
      }
    }
    expect(attributed).toBeGreaterThan(GAMES.length * 300)
  })

  it('orders events causally: miss → block/rebound, turnover → steal, foul after its turnover', () => {
    for (const r of GAMES) {
      const log = r.playByPlay
      log.forEach((entry, i) => {
        const prev = log[i - 1]
        if (/ steal$/.test(entry.text))
          expect(prev?.text).toMatch(
            /turnover \((bad pass|lost ball|stripped|fumbled catch|traveling)\)$/,
          )
        if (/ blocks /.test(entry.text)) expect(prev?.text).toMatch(/ misses /)
        if (/^Offensive foul/.test(entry.text)) {
          const fouler = /on (\S+)$/.exec(entry.text)?.[1]
          expect(prev?.text).toBe(`${fouler} turnover (offensive foul)`)
        }
        if (/ (offensive|defensive) rebound$/.test(entry.text)) {
          expect(prev?.text).toMatch(/ misses | blocks .*shot$/)
        }
      })
    }
  })

  it('putbacks: taken by the rebounder right after his offensive rebound, never assisted or on a break', () => {
    let putbacks = 0
    for (const r of GAMES) {
      r.playByPlay.forEach((entry, i) => {
        if (!isFieldGoal(entry.text) || !/ putback/.test(entry.text)) return
        putbacks++
        expect(entry.text).not.toMatch(/assist|fast break/)
        const shooter = entry.text.split(' ')[0]
        expect(r.playByPlay[i - 1]?.text).toBe(`${shooter} offensive rebound`)
      })
    }
    expect(putbacks).toBeGreaterThan(GAMES.length * 5)
  })

  it('every game passes the shared invariants (incl. the team-attribution check)', () => {
    GAMES.forEach((r, i) => expectValidResult(r, i < PRO_GAMES ? PRO_RULES : FIBA_RULES))
  })
})
