/** League-average rating on the 1–20 attribute scale; edges are measured relative to this. */
export const AVERAGE_RATING = 10.5

/** Keeps a number within the [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Converts a 1–20 rating into a roughly -1 to +1 scale, where 0 is league average. */
export function normalizeRating(rating: number): number {
  return (rating - AVERAGE_RATING) / 9.5
}

/** Shifts a base probability up or down by an "edge", returning a new probability. */
export function adjustProbability(base: number, edge: number): number {
  // Why log-odds: adding the edge on the log-odds scale always keeps the result between 0 and 1,
  // and gives natural diminishing returns near the extremes (a great shooter never reaches 100%).
  const logOdds = Math.log(base / (1 - base)) + edge
  return 1 / (1 + Math.exp(-logOdds))
}

/**
 * Smooth 0→1 ramp: 0 at or below `start`, 1 at or above `end`, an S-curve in between (zero slope
 * at both ends, so effects built on it fade in and out without a visible step).
 */
export function smoothStep(start: number, end: number, value: number): number {
  const t = clamp((value - start) / (end - start), 0, 1)
  return t * t * (3 - 2 * t)
}
