import { POSITIONS } from '../players/positions.ts'
import type { Player } from '../players/types.ts'
import type { LeagueRules } from '../world/rules.ts'
import { PRO_RULES } from '../world/rules.ts'
import type { HeadCoach } from '../staff/types.ts'
import type { RotationCoach, RotationOverride, RotationPlan } from './rotationTypes.ts'
import { NEUTRAL_ROTATION_COACH } from './rotationTypes.ts'
import {
  BENCH_DECAY,
  LINEUP_CANDIDATES,
  REFERENCE_GAME_MINUTES,
  ROTATION_SIZE,
  STARTER_MINUTES,
  STARTER_SPREAD_CAP,
  STARTER_SPREAD_PER_POINT,
} from './rotationTuning.ts'
import type { Evaluator } from './rotationValue.ts'
import { evaluatorOf, perceivedValue, slotCost } from './rotationValue.ts'
import type { TeamSystem } from './system.ts'

/** The 1-20 attributes of a coach that matter to the in-game rotation (neutral without a coach). */
export function rotationCoachOf(coach: HeadCoach | undefined): RotationCoach {
  return {
    rotationManagement:
      coach?.attributes.rotationManagement ?? NEUTRAL_ROTATION_COACH.rotationManagement,
    gameManagement: coach?.attributes.gameManagement ?? NEUTRAL_ROTATION_COACH.gameManagement,
  }
}

/** Total player-seconds in a regulation game (five on the floor for every second). */
export function totalPlayerSeconds(rules: LeagueRules): number {
  return rules.periods * rules.periodSeconds * 5
}

/**
 * The best five by slot (PG, SG, SF, PF, C) from the candidates: the assignment maximising the
 * sum of each player's value plus his slot cost. Why an exhaustive search: with at most
 * LINEUP_CANDIDATES players it is ~7k assignments, and a greedy fill can leave the only center
 * on the bench. The slot cost enforces "a ball handler and a big" through the PG and C slots.
 */
export function bestFive(candidates: readonly Player[], value: (p: Player) => number): Player[] {
  const pool = [...candidates].sort((a, b) => value(b) - value(a)).slice(0, LINEUP_CANDIDATES)
  const size = Math.min(POSITIONS.length, pool.length)
  // Each player's value and slot costs are computed once up front: the search below visits
  // thousands of assignments and must not recompute fit or ratings in its inner loop.
  const scores = pool.map((player) => {
    const base = value(player)
    return POSITIONS.map((position) => base + slotCost(player, position))
  })
  let bestOrder: number[] = pool.slice(0, size).map((_, i) => i)
  let bestScore = -Infinity
  const used = new Set<number>()
  const chosen: number[] = []
  /** Tries every player in the next slot. */
  const search = (score: number): void => {
    if (chosen.length === size) {
      // Strict > keeps the first (highest-valued) assignment on ties: deterministic.
      if (score > bestScore) {
        bestScore = score
        bestOrder = [...chosen]
      }
      return
    }
    const slot = chosen.length
    for (let i = 0; i < pool.length; i++) {
      if (used.has(i)) continue
      used.add(i)
      chosen.push(i)
      search(score + (scores[i]?.[slot] ?? 0))
      chosen.pop()
      used.delete(i)
    }
  }
  search(0)
  return bestOrder.map((i) => pool[i] as Player)
}

/** The coach's minutes for the five starters: the setting's average, spread by perceived value. */
function starterSeconds(
  starters: readonly Player[],
  values: ReadonlyMap<string, number>,
  system: TeamSystem,
  rules: LeagueRules,
): number[] {
  const scale = (rules.periods * rules.periodSeconds) / (REFERENCE_GAME_MINUTES * 60)
  const average = STARTER_MINUTES[system.starterMinutes] * 60 * scale
  const mean = starters.reduce((sum, p) => sum + (values.get(p.id) ?? 0), 0) / starters.length
  return starters.map((p) => {
    // Why a capped spread: the best starter plays a bit more than the fifth, but a star never
    // plays 40+ because of a high perceived value alone.
    const gap = ((values.get(p.id) ?? 0) - mean) * STARTER_SPREAD_PER_POINT
    return average + Math.max(-STARTER_SPREAD_CAP, Math.min(STARTER_SPREAD_CAP, gap)) * 60 * scale
  })
}

/** Splits `seconds` over `count` bench players with geometrically falling shares (best first). */
function benchSeconds(count: number, seconds: number): number[] {
  const weights = Array.from({ length: count }, (_, i) => BENCH_DECAY ** i)
  const sum = weights.reduce((a, b) => a + b, 0)
  return weights.map((w) => (seconds * w) / sum)
}

/** Target seconds for the whole roster: starters, then the bench in order, everyone else 0. */
function buildTargets(
  starters: readonly Player[],
  bench: readonly Player[],
  values: ReadonlyMap<string, number>,
  system: TeamSystem,
  rules: LeagueRules,
): Record<string, number> {
  const total = totalPlayerSeconds(rules)
  const targets: Record<string, number> = {}
  for (const p of [...starters, ...bench]) targets[p.id] = 0
  const rotationBench = bench.slice(
    0,
    Math.max(0, ROTATION_SIZE[system.rotationDepth] - starters.length),
  )
  let starterTimes = starterSeconds(starters, values, system, rules)
  // Without a bench the starters simply share the whole game.
  if (rotationBench.length === 0) starterTimes = starters.map(() => total / starters.length)
  starters.forEach((p, i) => (targets[p.id] = starterTimes[i] ?? 0))
  const left = Math.max(0, total - starterTimes.reduce((a, b) => a + b, 0))
  benchSeconds(rotationBench.length, left).forEach((s, i) => {
    const player = rotationBench[i]
    if (player) targets[player.id] = s
  })
  return targets
}

/** Builds the coach's own plan (no GM override). */
function coachPlan(
  roster: readonly Player[],
  evaluator: Evaluator,
  system: TeamSystem,
  rules: LeagueRules,
): RotationPlan {
  const values = new Map(roster.map((p) => [p.id, perceivedValue(p, system, evaluator)]))
  const value = (p: Player): number => values.get(p.id) ?? 0
  const starters = bestFive(roster, value)
  const bench = roster.filter((p) => !starters.includes(p)).sort((a, b) => value(b) - value(a))
  const closerValue = (p: Player): number => perceivedValue(p, system, evaluator, true)
  return {
    starters: starters.map((p) => p.id),
    order: [...starters, ...bench].map((p) => p.id),
    targetSeconds: buildTargets(starters, bench, values, system, rules),
    closers: bestFive(roster, closerValue).map((p) => p.id),
  }
}

/** Keeps only distinct ids that are on the roster, in the given order. */
function validIds(ids: readonly string[], roster: readonly Player[]): string[] {
  const onRoster = new Set(roster.map((p) => p.id))
  return [...new Set(ids)].filter((id) => onRoster.has(id))
}

/**
 * Applies the GM's rotation exactly (design section 4, no penalty): his starters (topped up from
 * the coach's if he named fewer than five valid ones), his bench order and his minutes. Ids that
 * aren't on the roster are ignored; players he didn't mention follow in the coach's order with
 * target 0 unless the GM gave them minutes.
 */
function applyOverride(
  base: RotationPlan,
  override: RotationOverride,
  roster: readonly Player[],
): RotationPlan {
  const starters = validIds(override.starters, roster).slice(0, 5)
  for (const id of base.starters)
    if (starters.length < 5 && !starters.includes(id)) starters.push(id)
  const order = validIds([...starters, ...override.order, ...base.order], roster)
  const targetSeconds: Record<string, number> = {}
  for (const id of order) targetSeconds[id] = Math.max(0, override.targetSeconds[id] ?? 0)
  return { starters, order, targetSeconds, closers: base.closers }
}

/**
 * The rotation plan for a game: the head coach's (perceived values, depth and starter minutes
 * from `system`), or the GM's override used exactly. With no coach the evaluator is neutral and
 * the system's own settings still apply. `rules` is an optional trailing extension of the agreed
 * contract (game length for the minute budget); it defaults to pro rules.
 */
export function buildRotationPlan(
  roster: readonly Player[],
  coach: HeadCoach | undefined,
  system: TeamSystem,
  override?: RotationOverride,
  rules: LeagueRules = PRO_RULES,
): RotationPlan {
  const base = coachPlan(roster, evaluatorOf(coach), system, rules)
  return override ? applyOverride(base, override, roster) : base
}
