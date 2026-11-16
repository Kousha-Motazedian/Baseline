import type { Position } from '../players/positions.ts'
import { POSITIONS } from '../players/positions.ts'
import type { Player } from '../players/types.ts'
import type { Rng } from '../shared/rng.ts'
import { clamp } from '../shared/probability.ts'
import type { PlayerGameStatus, Substitution, SubstitutionContext } from './rotationTypes.ts'
import {
  ATTENTION_AT_RM_1,
  ATTENTION_AT_RM_20,
  CLOSE_LEAD_POINTS,
  CLOSE_SAFETY,
  CLOSE_WINDOW_FACTOR_AT_GM_1,
  CLOSE_WINDOW_FACTOR_AT_GM_20,
  CLOSE_WINDOW_SECONDS,
  CLOSER_BONUS,
  CLOSER_MIN_ENERGY,
  FATIGUE_WEIGHT,
  FOUL_RETURN_SHARE_AT_GM_1,
  FOUL_RETURN_SHARE_AT_GM_20,
  FOUL_TABLE_LIMIT,
  FOUL_TROUBLE_MIN_FOULS,
  GARBAGE_LEAD_POINTS,
  GARBAGE_RANK_WEIGHT,
  GARBAGE_TRAILING_FACTOR,
  GARBAGE_SAFETY_AT_GM_1,
  GARBAGE_SAFETY_AT_GM_20,
  GM_CAUTIOUS,
  GM_GAMBLER,
  INCUMBENT_BONUS,
  INELIGIBLE_UTILITY,
  MAX_NORMAL_SUBS,
  OUT_OF_ROTATION_COST,
  PACE_WEIGHT_AT_RM_1,
  PACE_WEIGHT_AT_RM_20,
  RANK_WEIGHT,
  STAR_RANK,
  TIRED_LINE_AT_RM_1,
  TIRED_LINE_AT_RM_20,
} from './rotationTuning.ts'
import { slotCost } from './rotationValue.ts'

/** What kind of stretch of the game this is; it decides what the coach values. */
type Mode = 'normal' | 'finish' | 'garbage'

/** Linear blend of a 1-20 attribute between its value at 1 and at 20. */
function byRating(rating: number, at1: number, at20: number): number {
  return at1 + (at20 - at1) * clamp((rating - 1) / 19, 0, 1)
}

/** Seconds in a regulation game. */
function regulationSeconds(ctx: SubstitutionContext): number {
  return ctx.rules.periods * ctx.rules.periodSeconds
}

/** Share of the regulation game played so far (1 in overtime). */
function gameFraction(ctx: SubstitutionContext): number {
  if (ctx.period > ctx.rules.periods) return 1
  const elapsed = (ctx.period - 1) * ctx.rules.periodSeconds + (ctx.rules.periodSeconds - ctx.clock)
  return clamp(elapsed / regulationSeconds(ctx), 0, 1)
}

/** True in the last minutes of the final period or in overtime, with the game still close. */
function isFinish(ctx: SubstitutionContext): boolean {
  const { periods } = ctx.rules
  if (ctx.period < periods) return false
  // Why a window scaled by Game Management: a sharper coach reads the game and goes to his
  // closers a little sooner; a weaker one waits longer.
  const factor = byRating(
    ctx.coach.gameManagement,
    CLOSE_WINDOW_FACTOR_AT_GM_1,
    CLOSE_WINDOW_FACTOR_AT_GM_20,
  )
  const late = ctx.period > periods || ctx.clock <= CLOSE_WINDOW_SECONDS * factor
  const close = Math.abs(ctx.lead) <= CLOSE_LEAD_POINTS && Math.abs(ctx.leadSafety) < CLOSE_SAFETY
  return late && close
}

/** True in the second half with a big, safe lead for either side (the trailing coach quits too). */
function isGarbageTime(ctx: SubstitutionContext): boolean {
  if (ctx.period <= ctx.rules.periods / 2 || ctx.period > ctx.rules.periods) return false
  const safety = byRating(ctx.coach.gameManagement, GARBAGE_SAFETY_AT_GM_1, GARBAGE_SAFETY_AT_GM_20)
  // Why asymmetric: the leader rests his starters as soon as the game is safe, but the trailing
  // coach keeps fighting (and his starters on the floor) for longer before he gives up.
  const trailing = ctx.lead < 0
  const leadNeeded = trailing ? GARBAGE_LEAD_POINTS * GARBAGE_TRAILING_FACTOR : GARBAGE_LEAD_POINTS
  const safetyNeeded = trailing ? safety * GARBAGE_TRAILING_FACTOR : safety
  return Math.abs(ctx.lead) >= leadNeeded && Math.abs(ctx.leadSafety) >= safetyNeeded
}

/** The mode for this dead ball: the finish beats garbage time, which beats the normal pattern. */
function modeOf(ctx: SubstitutionContext): Mode {
  if (isFinish(ctx)) return 'finish'
  return isGarbageTime(ctx) ? 'garbage' : 'normal'
}

/**
 * Fouls at which a player sits this period (Infinity in overtime). The pro table (2/3/4/5 by
 * quarter) scales with the league's foul limit; top players of a cautious coach sit one foul
 * earlier, those of a gambling coach one later (Game Management).
 */
export function foulThreshold(ctx: SubstitutionContext, rank: number): number {
  const { periods, personalFoulLimit } = ctx.rules
  if (ctx.period > periods) return Infinity
  const top = personalFoulLimit - 1
  const base = Math.round(((ctx.period + 1) * personalFoulLimit) / FOUL_TABLE_LIMIT)
  let shift = 0
  if (rank < STAR_RANK && ctx.coach.gameManagement <= GM_CAUTIOUS) shift = -1
  if (rank < STAR_RANK && ctx.coach.gameManagement >= GM_GAMBLER) shift = 1
  return clamp(base + shift, FOUL_TROUBLE_MIN_FOULS, top)
}

/**
 * True if the coach is keeping this player on the bench for fouls: at or over the period's
 * threshold, unless the finish needs everybody or the period is far enough along that he may
 * return (earlier for a high Game Management; a low one sits his stars too long). Stateless on
 * purpose: once the clock passes the return point he plays and is not sat again.
 */
function sitsForFouls(ctx: SubstitutionContext, id: string, mode: Mode): boolean {
  if (mode === 'finish') return false
  const status = ctx.status[id]
  if (!status) return false
  const rank = Math.max(0, ctx.plan.order.indexOf(id))
  if (status.personalFouls < foulThreshold(ctx, rank)) return false
  const share = byRating(
    ctx.coach.gameManagement,
    FOUL_RETURN_SHARE_AT_GM_1,
    FOUL_RETURN_SHARE_AT_GM_20,
  )
  return ctx.clock > share * ctx.rules.periodSeconds
}

/** Energy below which fatigue starts to cost: a high Rotation Management coach rests players earlier. */
function tiredLine(ctx: SubstitutionContext): number {
  return byRating(ctx.coach.rotationManagement, TIRED_LINE_AT_RM_1, TIRED_LINE_AT_RM_20)
}

/** Utility lost to tiredness. */
function fatiguePenalty(ctx: SubstitutionContext, status: PlayerGameStatus): number {
  return -FATIGUE_WEIGHT * Math.max(0, tiredLine(ctx) - status.energy)
}

/**
 * Utilities already worked out for a context. A decision asks for the same player's utility many
 * times (every slot against every bench player, every pass of the swap loop), and the context
 * never changes during one decision, so it is computed once per (context, mode, player).
 */
const utilityCache = new WeakMap<SubstitutionContext, Map<string, number>>()

/** Utility of a player being on the floor now, before slot fit and the incumbent bonus. */
function utility(ctx: SubstitutionContext, id: string, mode: Mode): number {
  let cache = utilityCache.get(ctx)
  if (!cache) {
    cache = new Map()
    utilityCache.set(ctx, cache)
  }
  const key = `${mode}:${id}`
  let value = cache.get(key)
  if (value === undefined) {
    value = computeUtility(ctx, id, mode)
    cache.set(key, value)
  }
  return value
}

/** Computes a player's utility (see `utility`, which caches it). */
function computeUtility(ctx: SubstitutionContext, id: string, mode: Mode): number {
  const status = ctx.status[id]
  if (!status || status.disqualified || sitsForFouls(ctx, id, mode)) return INELIGIBLE_UTILITY
  const rank = ctx.plan.order.indexOf(id)
  const tired = fatiguePenalty(ctx, status)
  // Garbage time: deepest players first, whatever the plan's minutes say.
  if (mode === 'garbage') return GARBAGE_RANK_WEIGHT * rank + tired
  const target = ctx.plan.targetSeconds[id] ?? 0
  // Minutes owed by now: planned share of the game so far minus what he has played. Its weight
  // is the Rotation Management: a low one tracks the plan loosely and drifts from it.
  const owed = (target * gameFraction(ctx) - status.secondsPlayed) / 60
  const weight = byRating(ctx.coach.rotationManagement, PACE_WEIGHT_AT_RM_1, PACE_WEIGHT_AT_RM_20)
  let value = -RANK_WEIGHT * rank + weight * owed + tired
  if (target <= 0) value -= OUT_OF_ROTATION_COST
  if (mode === 'finish' && ctx.plan.closers.includes(id) && status.energy >= CLOSER_MIN_ENERGY) {
    value += CLOSER_BONUS
  }
  return value
}

/** The roster player with this id. */
function playerById(ctx: SubstitutionContext, id: string): Player | undefined {
  return ctx.roster.find((p) => p.id === id)
}

/** Utility of a player filling a slot's position (utility plus slot fit). */
function slotUtility(ctx: SubstitutionContext, id: string, position: Position, mode: Mode): number {
  const player = playerById(ctx, id)
  const base = utility(ctx, id, mode)
  return player && base > INELIGIBLE_UTILITY / 2 ? base + slotCost(player, position) : base
}

/** Bench players free to enter (not on the floor, not out for the game or sitting with fouls). */
function candidates(ctx: SubstitutionContext, onCourt: readonly string[], mode: Mode): string[] {
  return ctx.plan.order.filter(
    (id) => !onCourt.includes(id) && utility(ctx, id, mode) > INELIGIBLE_UTILITY / 2,
  )
}

/** The best entrant for a slot with the utility he would bring (undefined when the bench is empty). */
function bestEntrant(
  ctx: SubstitutionContext,
  pool: readonly string[],
  slot: number,
  mode: Mode,
): { id: string; value: number } | undefined {
  const position = POSITIONS[slot] as Position
  let best: { id: string; value: number } | undefined
  for (const id of pool) {
    const value = slotUtility(ctx, id, position, mode)
    // Strict > keeps the earlier player in rotation order on ties.
    if (!best || value > best.value) best = { id, value }
  }
  return best
}

/**
 * Best eligible player for a slot from the plan's order and position group: never on the
 * floor, disqualified or sitting with fouls. Used for disqualifications and injuries too.
 */
export function chooseReplacement(ctx: SubstitutionContext, slot: number): string | undefined {
  const mode = modeOf(ctx)
  return bestEntrant(ctx, candidates(ctx, ctx.onCourt, mode), slot, mode)?.id
}

/** A swap the coach wants, with how much better it makes the lineup. */
interface Swap {
  slot: number
  incomingId: string
  gain: number
  forced: boolean
}

/** The best swap for one slot, or undefined when the occupant should stay. */
function swapForSlot(
  ctx: SubstitutionContext,
  lineup: readonly string[],
  pool: readonly string[],
  slot: number,
  mode: Mode,
): Swap | undefined {
  const position = POSITIONS[slot] as Position
  const occupant = lineup[slot]
  if (occupant === undefined) return undefined
  const entrant = bestEntrant(ctx, pool, slot, mode)
  if (!entrant) return undefined
  const current = slotUtility(ctx, occupant, position, mode)
  // The incumbent bonus is the anti-churn hysteresis: a swap must beat it, and the player who
  // just came in gets it too, so nobody is swapped back and forth every possession.
  const gain = entrant.value - (current + INCUMBENT_BONUS)
  const forced = current <= INELIGIBLE_UTILITY / 2
  return gain > 0 || forced ? { slot, incomingId: entrant.id, gain, forced } : undefined
}

/**
 * The substitutions the coach makes at this dead ball: forced ones first (disqualified or
 * foul-sitting players), then voluntary ones by fatigue and minutes pace, the closers in a close
 * finish, or the deepest bench in garbage time. Deterministic given the rng (one draw per call:
 * how closely the coach is watching, a Rotation Management trait).
 */
export function decideSubstitutions(ctx: SubstitutionContext, rng: Rng): Substitution[] {
  const mode = modeOf(ctx)
  const attention = byRating(ctx.coach.rotationManagement, ATTENTION_AT_RM_1, ATTENTION_AT_RM_20)
  // Drawn every call so the stream of random numbers doesn't depend on what the coach decides.
  const watching = rng.next() < attention
  const limit = mode === 'normal' ? MAX_NORMAL_SUBS : POSITIONS.length
  const lineup = [...ctx.onCourt]
  const subs: Substitution[] = []
  while (subs.length < POSITIONS.length) {
    const pool = candidates(ctx, lineup, mode)
    const swaps = lineup
      .map((_, slot) => swapForSlot(ctx, lineup, pool, slot, mode))
      .filter((swap): swap is Swap => swap !== undefined)
      // A coach who isn't watching only reacts to what he is forced to; a swap that ends up
      // better only by tiredness is simply noticed late.
      .filter((swap) => swap.forced || watching)
    swaps.sort((a, b) => Number(b.forced) - Number(a.forced) || b.gain - a.gain)
    const best = swaps[0]
    if (!best) break
    if (!best.forced && subs.length >= limit) break
    subs.push({ slot: best.slot, incomingId: best.incomingId })
    lineup[best.slot] = best.incomingId
  }
  return subs
}
