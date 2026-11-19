import type { MatchTeam } from '../match/types.ts'
import type { HeadCoach } from '../staff/types.ts'
import type { LeagueRules } from '../world/rules.ts'
import { PRO_RULES } from '../world/rules.ts'
import { coachingInputs } from './coaching.ts'
import { buildRotationPlan, rotationCoachOf } from './rotationPlan.ts'
import type { RotationOverride } from './rotationTypes.ts'
import type { TeamSystem } from './system.ts'
import { BALANCED_SYSTEM } from './system.ts'

/**
 * The bridge from a club's head coach (and the GM's optional overrides) to the team the match
 * engine plays. Everything the engine needs from a coach goes through here: his system and
 * execution edges (`coaching`), his pre-game rotation (`rotation`) and the attributes behind his
 * in-game substitutions (`rotationCoach`). A team without a coach gets a neutral one.
 */

/** What a club decides before a game on top of its roster. */
export interface CoachedTeamOptions {
  /** The head coach; absent = no coach (neutral execution, balanced system, neutral rotation). */
  coach?: HeadCoach
  /** The GM's system override; absent = the coach's preferred system. */
  system?: TeamSystem
  /** The GM's own rotation (starters, bench order, minutes), used exactly. */
  rotationOverride?: RotationOverride
  /** The league's rules, for the game length in the minutes budget (default pro). */
  rules?: LeagueRules
}

/**
 * The match team for a game: the roster with the coach's coaching inputs, rotation plan and
 * rotation-coach attributes filled in. Pure; the input team is not changed.
 */
export function matchTeamFor(team: MatchTeam, options: CoachedTeamOptions = {}): MatchTeam {
  const { coach, rotationOverride, rules = PRO_RULES } = options
  const system =
    options.system ?? coach?.preferredSystem ?? team.coaching?.system ?? BALANCED_SYSTEM
  return {
    ...team,
    ...(coach ? { coaching: coachingInputs(coach, system) } : {}),
    rotation: buildRotationPlan(team.roster, coach, system, rotationOverride, rules),
    rotationCoach: rotationCoachOf(coach),
  }
}
