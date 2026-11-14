import type { Rng } from './rng.ts'

/** Draws a normally distributed number with the given mean and standard deviation. */
export function randomNormal(rng: Rng, mean: number, standardDeviation: number): number {
  // Box–Muller transform: turns two uniform draws into one standard-normal draw. `1 - next()`
  // keeps the log's argument in (0, 1] so it can never be log(0).
  const u = 1 - rng.next()
  const v = rng.next()
  const standard = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return mean + standard * standardDeviation
}
