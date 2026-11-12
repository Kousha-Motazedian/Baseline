import { describe, expect, it } from 'vitest'
import { createRng } from '../../../src/core/shared/rng'

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(123)
    const b = createRng(123)
    const seqA = Array.from({ length: 10 }, () => a.next())
    const seqB = Array.from({ length: 10 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    expect(createRng(1).next()).not.toEqual(createRng(2).next())
  })

  it('keeps next() within [0, 1)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('keeps nextInt() within the inclusive range and hits both ends', () => {
    const rng = createRng(99)
    const seen = new Set<number>()
    for (let i = 0; i < 1_000; i++) {
      const value = rng.nextInt(1, 6)
      expect(value).toBeGreaterThanOrEqual(1)
      expect(value).toBeLessThanOrEqual(6)
      seen.add(value)
    }
    expect(seen).toEqual(new Set([1, 2, 3, 4, 5, 6]))
  })

  it('throws on invalid input', () => {
    const rng = createRng(1)
    expect(() => rng.nextInt(5, 1)).toThrow(RangeError)
    expect(() => rng.pick([])).toThrow(RangeError)
  })
})
