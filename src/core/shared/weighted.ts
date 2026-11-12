import type { Rng } from './rng.ts'

/** Picks one item at random, where each item's chance is proportional to its weight. */
export function pickWeighted<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number): T {
  const weights = items.map((item) => Math.max(0, weightOf(item)))
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (items.length === 0) throw new RangeError('pickWeighted: cannot pick from an empty array')
  // If every weight is zero, fall back to a uniform pick rather than failing.
  if (total === 0) return rng.pick(items)

  let roll = rng.next() * total
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i] as number
    if (roll < 0) return items[i] as T
  }
  return items[items.length - 1] as T
}
