import type { VisibleAttributeKey } from '../players/attributes.ts'
import { VISIBLE_ATTRIBUTE_KEYS } from '../players/attributes.ts'
import type { AttributeWeights, PlayerProfile, Position } from '../players/positions.ts'
import {
  POSITION_PROFILES,
  positionRatings,
  primaryPosition,
  weightedAverage,
} from '../players/positions.ts'
import type { RoleFit, RoleName } from '../players/roles.ts'
import { roleFits } from '../players/roles.ts'
import { clamp } from '../shared/probability.ts'
import type { SystemSetting, TeamSystem } from './system.ts'
import { BALANCED_SYSTEM, DEFENSIVE_SETTINGS, OFFENSIVE_SETTINGS } from './system.ts'
import { FIT_ROLE_GAP_FLOOR, FIT_ROLE_PART, FIT_SCALE } from './tuning.ts'

/**
 * Role/system fit (the Hawks principle, docs/design/coaches.md section 3): how well a player's
 * game suits the system his team runs. Fit is about WHAT a player does well, never how good he is
 * overall: it is computed from his roles and the shape of his attributes, never from Current
 * Ability (roleFits doesn't read CA; playerRoles, which does, is deliberately not used) and never
 * from his overall level (both parts below are relative to the player's own level).
 */

/** What one system option asks of its players. */
export interface FitDemand {
  /** Roles that suit the option. */
  roles: readonly RoleName[]
  /** Attributes the option leans on, weighted. */
  attributes: AttributeWeights
  /**
   * League-average raw fit for this option over generated players, subtracted so the average
   * player scores 0 (calibration data, measured with `npm run sim:batch -- --fit-stats`). Without
   * it, options wanting common roles would be a free buff for every roster.
   */
  center: number
}

/** A player's fit for a system at each end of the floor, each in −1 (poor) … +1 (perfect). */
export interface PlayerFit {
  offense: number
  defense: number
}

/** Zero fit: the balanced system asks nothing of anyone. */
export const NO_FIT: PlayerFit = { offense: 0, defense: 0 }

/** Demands of one setting's non-neutral options. */
type SettingDemands<K extends SystemSetting> = Partial<Record<TeamSystem[K], FitDemand>>

/**
 * What each non-neutral option wants. Neutral options ('balanced', 'driveAndKick') want nothing.
 * The rotation settings have no demands (no engine effect yet).
 */
export const FIT_DEMANDS: { [K in SystemSetting]?: SettingDemands<K> } = {
  pace: {
    fast: {
      roles: ['Slasher', 'Rim Runner', 'Scoring Guard'],
      attributes: { speed: 3, quickness: 2, stamina: 2 },
      center: -0.78,
    },
    slow: {
      roles: ['Post Scorer', 'Floor General', 'Playmaking Big'],
      attributes: { offensiveIq: 3, postScoring: 2, strength: 1, composure: 1 },
      center: -0.82,
    },
  },
  shotProfile: {
    threeHeavy: {
      roles: ['Sharpshooter', '3-and-D Wing', 'Stretch Big'],
      attributes: { threePoint: 4, offBallMovement: 1 },
      center: -0.96,
    },
    insideOut: {
      roles: ['Post Scorer', 'Rim Runner', 'Slasher'],
      attributes: { postScoring: 2, finishing: 2, strength: 1 },
      center: -0.8,
    },
  },
  ballMovement: {
    motion: {
      roles: ['Floor General', 'Point Forward', 'Playmaking Big'],
      attributes: { passing: 3, offBallMovement: 2, teamwork: 2, offensiveIq: 1 },
      center: -1.1,
    },
    isolation: {
      roles: ['Scoring Guard', 'Slasher', 'All-Around'],
      attributes: { driving: 3, ballHandling: 2, midRange: 2 },
      center: -0.8,
    },
  },
  primaryAction: {
    pickAndRoll: {
      roles: ['Floor General', 'Scoring Guard', 'Rim Runner'],
      attributes: { ballHandling: 2, passing: 2, finishing: 1, vertical: 1 },
      center: -0.78,
    },
    postUps: {
      roles: ['Post Scorer', 'Playmaking Big'],
      attributes: { postScoring: 3, strength: 2 },
      center: -1.04,
    },
    offBall: {
      roles: ['Sharpshooter', 'Slasher', 'Two-Way Forward'],
      attributes: { offBallMovement: 3, threePoint: 1, finishing: 1 },
      center: -0.85,
    },
  },
  transition: {
    push: {
      roles: ['Slasher', 'Rim Runner', 'Scoring Guard'],
      attributes: { speed: 3, finishing: 1, stamina: 1 },
      center: -0.76,
    },
    getBack: {
      roles: ['Lockdown Defender', '3-and-D Wing', 'Rim Protector'],
      attributes: { hustle: 2, defensiveIq: 2, speed: 1 },
      center: -0.81,
    },
  },
  offensiveRebounding: {
    crash: {
      roles: ['Rim Runner', 'Rim Protector', 'Post Scorer'],
      attributes: { offensiveRebounding: 3, vertical: 1, hustle: 1, strength: 1 },
      center: -0.92,
    },
    getBack: {
      roles: ['Lockdown Defender', '3-and-D Wing', 'Two-Way Forward'],
      attributes: { speed: 2, hustle: 2 },
      center: -0.9,
    },
  },
  defensivePressure: {
    aggressive: {
      roles: ['Lockdown Defender', '3-and-D Wing'],
      attributes: { stealing: 3, quickness: 2, perimeterDefense: 2, stamina: 1 },
      center: -1.09,
    },
    conservative: {
      roles: ['Rim Protector', 'Two-Way Forward', 'Lockdown Defender'],
      attributes: { discipline: 3, defensiveIq: 2, perimeterDefense: 1 },
      center: -0.78,
    },
  },
  helpPriority: {
    protectPaint: {
      roles: ['Rim Protector'],
      attributes: { interiorDefense: 3, shotBlocking: 3, defensiveRebounding: 1 },
      center: -1.15,
    },
    runShooters: {
      roles: ['3-and-D Wing', 'Lockdown Defender'],
      attributes: { perimeterDefense: 3, quickness: 2, speed: 1 },
      center: -1.09,
    },
  },
}

/** Attributes that track a player's level (the generator draws Leadership and Work Ethic apart). */
const LEVEL_KEYS: readonly VisibleAttributeKey[] = VISIBLE_ATTRIBUTE_KEYS.filter(
  (key) => key !== 'leadership' && key !== 'workEthic',
)

/** What a player's fit is judged from: his primary position and his role fits (computed once). */
export interface FitBasis {
  player: PlayerProfile
  primary: Position
  roles: readonly RoleFit[]
}

/** Computes the parts of a player that every setting's fit needs. */
export function fitBasis(player: PlayerProfile): FitBasis {
  return { player, primary: primaryPosition(positionRatings(player)), roles: roleFits(player) }
}

/**
 * Role part (≤ 0): how far the best wanted role is below the player's own best role. 0 when his
 * role is one the option wants; FIT_ROLE_GAP_FLOOR below when none of the wanted roles is open to
 * his positions. Why a gap rather than "is he exactly that role": a near-miss (a shooter labelled
 * 3-and-D Wing in a system that wants Sharpshooters) should still fit well.
 */
export function roleTerm(roles: readonly RoleFit[], wanted: readonly RoleName[]): number {
  const best = roles[0]
  const match = roles.find((fit) => wanted.includes(fit.role))
  if (!best || !match) return -FIT_ROLE_GAP_FLOOR
  return Math.max(match.fit - best.fit, -FIT_ROLE_GAP_FLOOR)
}

/**
 * Attribute part: how much the wanted attributes stand out in this player, compared with a typical
 * player at his position at the same level. Each attribute minus his position's typical offset is
 * his "residual"; the wanted attributes' residual minus his average residual is level-free, so a
 * star doesn't fit every system better just by being good.
 */
export function attributeTerm(basis: FitBasis, wanted: AttributeWeights): number {
  const profile = POSITION_PROFILES[basis.primary]
  const residual: Partial<Record<VisibleAttributeKey, number>> = {}
  for (const key of LEVEL_KEYS) residual[key] = basis.player.attributes[key] - (profile[key] ?? 0)
  const average = LEVEL_KEYS.reduce((sum, key) => sum + (residual[key] ?? 0), 0) / LEVEL_KEYS.length
  return weightedAverage(residual, wanted) - average
}

/** A player's raw (uncentered, unscaled) fit for one option. */
export function rawFit(basis: FitBasis, demand: FitDemand): number {
  return (
    FIT_ROLE_PART * roleTerm(basis.roles, demand.roles) +
    (1 - FIT_ROLE_PART) * attributeTerm(basis, demand.attributes)
  )
}

/** A player's fit for one option on the −1 … +1 scale (0 = a typical player). */
export function optionFit(basis: FitBasis, demand: FitDemand): number {
  return clamp((rawFit(basis, demand) - demand.center) / FIT_SCALE, -1, 1)
}

/** The demand of the option a system picks for one setting (undefined for neutral options). */
export function demandFor(system: TeamSystem, setting: SystemSetting): FitDemand | undefined {
  if (system[setting] === BALANCED_SYSTEM[setting]) return undefined
  const demands = FIT_DEMANDS[setting] as Partial<Record<string, FitDemand>> | undefined
  return demands?.[system[setting]]
}

/** The demands a system makes at one end of the floor. */
export function sideDemands(system: TeamSystem, settings: readonly SystemSetting[]): FitDemand[] {
  return settings
    .map((setting) => demandFor(system, setting))
    .filter((demand) => demand !== undefined)
}

/**
 * Average fit over a side's demands (0 when the side asks nothing). Averaged, not summed, so a
 * system with many non-neutral settings doesn't reward (or punish) fit more than one with few.
 */
function sideFit(basis: FitBasis, demands: readonly FitDemand[]): number {
  if (demands.length === 0) return 0
  return demands.reduce((sum, demand) => sum + optionFit(basis, demand), 0) / demands.length
}

/** True if a system makes no fit demands at all (every engine setting neutral). */
export function isNeutralForFit(system: TeamSystem): boolean {
  return [...OFFENSIVE_SETTINGS, ...DEFENSIVE_SETTINGS].every((s) => !demandFor(system, s))
}

/** A player's fit for a system at each end of the floor. */
export function playerFit(player: PlayerProfile, system: TeamSystem): PlayerFit {
  if (isNeutralForFit(system)) return NO_FIT
  const basis = fitBasis(player)
  return {
    offense: sideFit(basis, sideDemands(system, OFFENSIVE_SETTINGS)),
    defense: sideFit(basis, sideDemands(system, DEFENSIVE_SETTINGS)),
  }
}

/**
 * A lineup's average fit (offense and defense averaged) for a system: how well a group of players
 * suits it. Used to rank systems for a roster (AI coaches, the batch-sim experiments).
 */
export function lineupFit(players: readonly PlayerProfile[], system: TeamSystem): number {
  if (players.length === 0) return 0
  const total = players.reduce((sum, player) => {
    const fit = playerFit(player, system)
    return sum + (fit.offense + fit.defense) / 2
  }, 0)
  return total / players.length
}
