import { currentAbility } from './currentAbility.ts'
import type { VisibleAttributeKey } from './attributes.ts'
import type { AttributeWeights, PlayerProfile, Position } from './positions.ts'
import {
  POSITION_PROFILES,
  POSITIONS,
  positionRatings,
  positionsPlayed,
  primaryPosition,
  weightedAverage,
} from './positions.ts'

/**
 * Roles: short labels for HOW a player plays ("3-and-D Wing", "Rim Runner"). Each role is a
 * template of weighted attributes; a player gets the best-fitting role(s) among those open to his
 * positions played. Computed, never stored (docs/design/player-roles.md, section 2). Descriptive
 * only for now: nothing in the match engine reads roles.
 */

/** Every role name, in the doc's order (also the tie-break order). */
export const ROLE_NAMES = [
  'Floor General',
  'Scoring Guard',
  'Sharpshooter',
  'Slasher',
  '3-and-D Wing',
  'Lockdown Defender',
  'Point Forward',
  'Two-Way Forward',
  'Stretch Big',
  'Post Scorer',
  'Rim Runner',
  'Rim Protector',
  'Playmaking Big',
  'All-Around',
] as const

/** One role name. */
export type RoleName = (typeof ROLE_NAMES)[number]

/** A role template: what it rewards, what it expects to be weak, and who can hold it. */
export interface RoleTemplate {
  name: RoleName
  /** Positions the role is open to; 'any' for every position. */
  positions: readonly Position[] | 'any'
  /** Attributes that define the role, weighted. */
  weights: AttributeWeights
  /**
   * Attributes the role expects to be clearly weaker than its core (e.g. a Rim Runner's limited
   * skill). Strength here lowers the fit; see WEAKNESS_GAP.
   */
  weakAt?: AttributeWeights
  /**
   * The skill(s) the role's label promises. Each one below ROLE_SKILL_FLOOR costs fit, so a
   * "Stretch Big" can actually shoot and a "Playmaking Big" can actually pass.
   */
  defining?: readonly VisibleAttributeKey[]
  /**
   * For broad roles with no single defining skill: the template's average itself must reach
   * ROLE_SKILL_FLOOR ("strong across the board" has to mean strong).
   */
  broad?: boolean
  /**
   * What kind of strength the role describes. Two roles sharing a family say the same thing
   * twice (Sharpshooter + Stretch Big), so they never make up a two-role pair.
   */
  families: readonly RoleFamily[]
  /** Flat bonus added to the fit for broad templates (see ALL_AROUND_BONUS). */
  bonus?: number
}

/** The kinds of strength roles describe (see RoleTemplate.families). */
export type RoleFamily =
  | 'playmaking'
  | 'shotCreation'
  | 'shooting'
  | 'finishing'
  | 'perimeterDefense'
  | 'interiorDefense'
  | 'post'
  | 'twoWay'
  | 'allAround'

/**
 * A role and how well a player fits it (rating points relative to a typical player at the role's
 * position; higher is better).
 */
export interface RoleFit {
  role: RoleName
  fit: number
}

/** Perimeter scoring, the "weak" side of the defense-first and limited-skill roles. */
const SCORING_SKILLS: AttributeWeights = {
  driving: 1,
  midRange: 1,
  threePoint: 1,
  finishing: 1,
}

/** Perimeter and post skills a Rim Runner is expected to lack. */
const BIG_SKILLS: AttributeWeights = {
  postScoring: 1,
  midRange: 1,
  threePoint: 1,
  ballHandling: 1,
  passing: 1,
}

/**
 * Bonus for the broad templates (All-Around, Two-Way Forward). The best of a dozen narrow templates
 * almost always stands out a little by chance, while a broad average can't, so without a bonus
 * broad roles would almost never win. Tuned so they appear at plausible rates (see
 * player-roles.md "Calibration results").
 */
const ALL_AROUND_BONUS = 0.4
const TWO_WAY_BONUS = 0.5

/**
 * The 14 role templates from the design doc. Weights are tuning data; each template leads with
 * the attributes the doc lists for the role.
 */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    name: 'Floor General',
    defining: ['passing'],
    families: ['playmaking'],
    positions: ['PG'],
    weights: {
      passing: 5,
      offensiveIq: 4,
      ballHandling: 4,
      teamwork: 2,
      driving: 1,
      threePoint: 1,
    },
  },
  {
    name: 'Scoring Guard',
    defining: ['driving'],
    families: ['shotCreation'],
    positions: ['PG', 'SG'],
    weights: { driving: 4, midRange: 3, threePoint: 3, ballHandling: 3, finishing: 1.5 },
  },
  {
    name: 'Sharpshooter',
    defining: ['threePoint'],
    families: ['shooting'],
    positions: ['SG', 'SF'],
    weights: { threePoint: 6, offBallMovement: 3, freeThrow: 2, midRange: 1.5 },
  },
  {
    name: 'Slasher',
    defining: ['driving', 'finishing'],
    families: ['finishing'],
    positions: ['SG', 'SF'],
    weights: { driving: 5, finishing: 4, quickness: 3, vertical: 2 },
  },
  {
    name: '3-and-D Wing',
    defining: ['threePoint', 'perimeterDefense'],
    families: ['shooting', 'perimeterDefense'],
    positions: ['SG', 'SF'],
    weights: { threePoint: 4, perimeterDefense: 4, stealing: 2, defensiveIq: 1 },
  },
  {
    name: 'Lockdown Defender',
    defining: ['perimeterDefense'],
    families: ['perimeterDefense'],
    positions: ['PG', 'SG', 'SF'],
    weights: { perimeterDefense: 5, quickness: 3, stealing: 3, defensiveIq: 3 },
    weakAt: SCORING_SKILLS,
  },
  {
    name: 'Point Forward',
    defining: ['passing', 'ballHandling'],
    families: ['playmaking'],
    positions: ['SF', 'PF'],
    weights: { passing: 5, ballHandling: 4, offensiveIq: 3 },
  },
  {
    name: 'Two-Way Forward',
    broad: true,
    families: ['twoWay'],
    bonus: TWO_WAY_BONUS,
    positions: ['SF', 'PF'],
    weights: {
      driving: 2,
      finishing: 2,
      midRange: 1.5,
      threePoint: 1.5,
      perimeterDefense: 2,
      interiorDefense: 2,
      defensiveRebounding: 2,
    },
  },
  {
    name: 'Stretch Big',
    defining: ['threePoint'],
    families: ['shooting'],
    positions: ['PF', 'C'],
    weights: { threePoint: 5, midRange: 3, freeThrow: 1 },
  },
  {
    name: 'Post Scorer',
    defining: ['postScoring'],
    families: ['post'],
    positions: ['PF', 'C'],
    weights: { postScoring: 6, strength: 3, finishing: 2 },
  },
  {
    name: 'Rim Runner',
    defining: ['finishing'],
    families: ['finishing'],
    positions: ['PF', 'C'],
    weights: { finishing: 4, vertical: 3, offensiveRebounding: 3, speed: 2 },
    weakAt: BIG_SKILLS,
  },
  {
    name: 'Rim Protector',
    defining: ['shotBlocking'],
    families: ['interiorDefense'],
    positions: ['PF', 'C'],
    weights: { shotBlocking: 5, interiorDefense: 4, defensiveRebounding: 3 },
  },
  {
    name: 'Playmaking Big',
    defining: ['passing'],
    families: ['playmaking'],
    positions: ['PF', 'C'],
    weights: { passing: 5, offensiveIq: 4, ballHandling: 1 },
  },
  {
    name: 'All-Around',
    broad: true,
    families: ['allAround'],
    positions: 'any',
    weights: {
      driving: 1,
      finishing: 1,
      midRange: 1,
      threePoint: 1,
      passing: 1,
      ballHandling: 1,
      perimeterDefense: 1,
      interiorDefense: 1,
      defensiveRebounding: 1,
      offensiveIq: 1,
      defensiveIq: 1,
    },
    bonus: ALL_AROUND_BONUS,
  },
]

/**
 * How far below the role's core the "weak" attributes must sit before they stop costing fit, and
 * how much each point above that costs. A Lockdown Defender may score a little, but a player who
 * defends at 16 and scores at 15 is a 3-and-D Wing or All-Around, not a lockdown specialist.
 */
const WEAKNESS_GAP = 3
const WEAKNESS_PENALTY = 0.6

/**
 * The level a role's defining skills must reach (about a generated league's average for those
 * skills), and the fit lost per point below it. Why: fits are judged relative to the position
 * norm, so a center who shoots 7 (well above the 5 a typical center shoots) would otherwise be a
 * "Stretch Big". The penalty is steep so a label never contradicts the player's ratings, except
 * for weak players whose every role falls short (they get the least-bad one).
 */
const ROLE_SKILL_FLOOR = 10
const SKILL_SHORTFALL_PENALTY = 3

/**
 * Fit lost by a role that is not open to the player's primary position (one he only reaches
 * through a secondary position). A wing who can also play PF should be a big only when his big
 * skills clearly stand out; his primary position's roles get the benefit of the doubt.
 */
const OFF_PRIMARY_PENALTY = 0.5

/**
 * Closeness threshold for a superstar's second role: it counts only when its fit is within this
 * many points of the first. Tuned so about 10% of generated superstars (CA 80–89) qualify; see
 * player-roles.md "Calibration results".
 */
export const SUPERSTAR_SECOND_ROLE_CLOSENESS = 0.085

/** CA at or above which a player always gets two roles (Generational and GOAT). */
export const TWO_ROLES_CA = 90
/** CA at or above which a player may get a second role if it fits closely enough (Superstar). */
export const SECOND_ROLE_CA = 80

/**
 * How strongly a template's attributes stand out in a typical player at a position: the template's
 * weighted average over that position's profile offsets (0 = no different from the player's level).
 */
function positionNorm(template: RoleTemplate, position: Position): number {
  return weightedAverage(POSITION_PROFILES[position], template.weights)
}

/**
 * The position a role is judged at for a player: the role's own position nearest his primary one
 * (the primary itself when the role is open to it). Why not always the primary: an SF who also
 * plays PF is a Rim Protector only if he protects the rim like a typical PF, not merely better
 * than a typical SF. Ties go to the smaller position (judging a wing against the guard norm).
 */
export function normPosition(template: RoleTemplate, primary: Position): Position {
  if (template.positions === 'any') return primary
  const index = POSITIONS.indexOf(primary)
  let best = template.positions[0] as Position
  for (const position of template.positions) {
    const distance = Math.abs(POSITIONS.indexOf(position) - index)
    if (distance < Math.abs(POSITIONS.indexOf(best) - index)) best = position
  }
  return best
}

/**
 * Fit lost for falling below ROLE_SKILL_FLOOR: summed over the role's defining skills, or on the
 * template average itself for a broad role.
 */
function skillShortfall(player: PlayerProfile, template: RoleTemplate, core: number): number {
  const values = template.broad
    ? [core]
    : (template.defining ?? []).map((key) => player.attributes[key])
  const short = values.reduce((sum, value) => sum + Math.max(0, ROLE_SKILL_FLOOR - value), 0)
  return short * SKILL_SHORTFALL_PENALTY
}

/** Fit lost when a role's "weak" side is not clearly weaker than its core (see WEAKNESS_GAP). */
function weaknessPenalty(player: PlayerProfile, template: RoleTemplate, core: number): number {
  if (!template.weakAt) return 0
  const weakness = weightedAverage(player.attributes, template.weakAt)
  // Only the part of the weak side that rises above (core − gap) is penalised.
  return Math.max(0, weakness - (core - WEAKNESS_GAP)) * WEAKNESS_PENALTY
}

/**
 * How well a player fits one role template. Mainly relative: the template's average minus that of
 * a typical player at the role's position (see normPosition). Why relative: a center's rebounding
 * and shot blocking are always his highest ratings, so on raw numbers nearly every center would be
 * a Rim Protector and none a Stretch Big; the norm makes the role say what stands out about this
 * player. An absolute check (skillShortfall) keeps the label honest.
 */
export function roleFit(player: PlayerProfile, template: RoleTemplate, primary: Position): number {
  const core = weightedAverage(player.attributes, template.weights)
  const position = normPosition(template, primary)
  const offPrimary = position === primary ? 0 : OFF_PRIMARY_PENALTY
  const penalties =
    weaknessPenalty(player, template, core) + skillShortfall(player, template, core) + offPrimary
  return core - positionNorm(template, position) - penalties + (template.bonus ?? 0)
}

/** True if a role is open to at least one of the given positions. */
function isOpenTo(template: RoleTemplate, positions: readonly Position[]): boolean {
  return template.positions === 'any' || template.positions.some((p) => positions.includes(p))
}

/**
 * Fits for every role open to the player's positions played, best first. Ties keep the template
 * order (Array.prototype.sort is stable), so the result is deterministic.
 */
export function roleFits(player: PlayerProfile): RoleFit[] {
  const ratings = positionRatings(player)
  const positions = positionsPlayed(ratings)
  const primary = primaryPosition(ratings)
  return ROLE_TEMPLATES.filter((template) => isOpenTo(template, positions))
    .map((template) => ({ role: template.name, fit: roleFit(player, template, primary) }))
    .sort((a, b) => b.fit - a.fit)
}

/** The template for a role name. */
function templateOf(role: RoleName): RoleTemplate {
  return ROLE_TEMPLATES.find((t) => t.name === role) as RoleTemplate
}

/** The attribute a template weighs most (its first-listed one on ties). */
function leadingSkill(template: RoleTemplate): VisibleAttributeKey {
  const entries = Object.entries(template.weights) as [VisibleAttributeKey, number][]
  return entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0]
}

/** True if `a` expects to be weak at what `b` is built on (e.g. Rim Runner vs. Stretch Big). */
function contradicts(a: RoleTemplate, b: RoleTemplate): boolean {
  return (a.weakAt?.[leadingSkill(b)] ?? 0) > 0
}

/**
 * True if two roles describe different strengths, so together they say "elite in two different
 * ways": no shared family (Sharpshooter + Stretch Big is the same skill twice) and neither role
 * expects to be weak at what the other is built on (Rim Runner + Stretch Big contradict).
 */
export function areDistinctRoles(a: RoleName, b: RoleName): boolean {
  const ta = templateOf(a)
  const tb = templateOf(b)
  const sharesFamily = ta.families.some((family) => tb.families.includes(family))
  return !sharesFamily && !contradicts(ta, tb) && !contradicts(tb, ta)
}

/** The best fit after the first that is distinct from it (see areDistinctRoles), if any. */
export function secondRoleFit(fits: readonly RoleFit[]): RoleFit | undefined {
  const [first, ...rest] = fits
  if (!first) return undefined
  return rest.find((fit) => areDistinctRoles(first.role, fit.role))
}

/**
 * How many roles a player holds, from his CA and his fits (best first). A second role marks a
 * player who is elite in two different ways, so only a distinct runner-up counts (see
 * secondRoleFit): Generational/GOAT players always get it; a superstar only when it fits almost as
 * well as the best (a computed rule, not a random roll).
 */
export function roleCount(ca: number, fits: readonly RoleFit[]): 1 | 2 {
  const first = fits[0]
  const second = secondRoleFit(fits)
  if (!first || !second) return 1
  if (ca >= TWO_ROLES_CA) return 2
  if (ca >= SECOND_ROLE_CA && first.fit - second.fit <= SUPERSTAR_SECOND_ROLE_CLOSENESS) return 2
  return 1
}

/** A player's role(s), best first. Pass `ca` if already known to avoid recomputing it. */
export function playerRoles(player: PlayerProfile, ca = currentAbility(player)): RoleName[] {
  const fits = roleFits(player)
  const first = fits[0]
  if (!first) return []
  const second = secondRoleFit(fits)
  return roleCount(ca, fits) === 2 && second ? [first.role, second.role] : [first.role]
}
