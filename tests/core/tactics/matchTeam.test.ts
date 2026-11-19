/** The bridge from a head coach (and GM overrides) to the team the match engine plays. */
import { describe, expect, it } from 'vitest'
import { simulateGame } from '../../../src/core/match/game.ts'
import { createRng } from '../../../src/core/shared/rng.ts'
import { generateCoach } from '../../../src/core/staff/coachGenerator.ts'
import { coachingInputs } from '../../../src/core/tactics/coaching.ts'
import { matchTeamFor } from '../../../src/core/tactics/matchTeam.ts'
import { buildRotationPlan } from '../../../src/core/tactics/rotation.ts'
import { archetypeSystem, BALANCED_SYSTEM } from '../../../src/core/tactics/system.ts'
import { FIBA_RULES, PRO_RULES } from '../../../src/core/world/rules.ts'
import { generatedPair } from '../../helpers/fixtures.ts'

const [TEAM, OPPONENT] = generatedPair(61)
const COACH = generateCoach(createRng(5), { id: 'c1' })

describe('matchTeamFor', () => {
  it('fills coaching, rotation and rotation coach from the head coach', () => {
    const team = matchTeamFor(TEAM, { coach: COACH })
    expect(team.coaching).toEqual(coachingInputs(COACH, COACH.preferredSystem))
    expect(team.rotation).toEqual(
      buildRotationPlan(TEAM.roster, COACH, COACH.preferredSystem, undefined, PRO_RULES),
    )
    expect(team.rotationCoach).toEqual({
      rotationManagement: COACH.attributes.rotationManagement,
      gameManagement: COACH.attributes.gameManagement,
    })
    expect(TEAM.rotation).toBeUndefined()
  })

  it('a GM system override replaces the coach system (and costs familiarity)', () => {
    const system = archetypeSystem('gritAndGrind')
    const team = matchTeamFor(TEAM, { coach: COACH, system })
    expect(team.coaching?.system).toEqual(system)
    expect(team.coaching).toEqual(coachingInputs(COACH, system))
  })

  it('a GM rotation override is used exactly', () => {
    const ids = TEAM.roster.map((p) => p.id)
    const targetSeconds = Object.fromEntries(ids.map((id, i) => [id, i < 8 ? 1800 : 0]))
    const team = matchTeamFor(TEAM, {
      coach: COACH,
      rotationOverride: { starters: ids.slice(8, 13), order: ids, targetSeconds },
    })
    expect(team.rotation?.starters).toEqual(ids.slice(8, 13))
    expect(team.rotation?.targetSeconds[ids[0] as string]).toBe(1800)
  })

  it('uses the league rules for the minutes budget', () => {
    const pro = matchTeamFor(TEAM, { coach: COACH })
    const fiba = matchTeamFor(TEAM, { coach: COACH, rules: FIBA_RULES })
    const sum = (t: typeof pro) =>
      Object.values(t.rotation?.targetSeconds ?? {}).reduce((a, b) => a + b, 0)
    expect(sum(fiba)).toBeLessThan(sum(pro))
  })

  it('without a coach: neutral rotation coach, balanced system, no coaching inputs added', () => {
    const team = matchTeamFor(TEAM)
    expect(team.coaching).toBeUndefined()
    expect(team.rotationCoach).toEqual({ rotationManagement: 10.5, gameManagement: 10.5 })
    expect(team.rotation).toEqual(buildRotationPlan(TEAM.roster, undefined, BALANCED_SYSTEM))
  })

  it('a coached team plays a valid, deterministic game', () => {
    const home = matchTeamFor(TEAM, { coach: COACH })
    const away = matchTeamFor(OPPONENT, { coach: generateCoach(createRng(6), { id: 'c2' }) })
    const first = simulateGame({ home, away, rules: PRO_RULES, seed: 3 })
    expect(simulateGame({ home, away, rules: PRO_RULES, seed: 3 })).toEqual(first)
    expect(first.home.players.filter((p) => p.started)).toHaveLength(5)
  })
})
