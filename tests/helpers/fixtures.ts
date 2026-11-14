/**
 * Shared test fixtures: hand-built players and teams with exact, predictable ratings, plus helpers
 * for tweaking generated ones. Kept here so every match-engine test builds players the same way.
 */
import { generateTeam } from '../../src/core/data/teamGenerator.ts'
import type { MatchTeam } from '../../src/core/match/types.ts'
import type {
  HiddenAttributes,
  VisibleAttributeKey,
  VisibleAttributes,
} from '../../src/core/players/attributes.ts'
import { VISIBLE_ATTRIBUTE_KEYS } from '../../src/core/players/attributes.ts'
import type { Player } from '../../src/core/players/types.ts'
import { createRng } from '../../src/core/shared/rng.ts'

/** Every visible attribute set to the same rating. */
export function flatAttributes(rating: number): VisibleAttributes {
  return Object.fromEntries(VISIBLE_ATTRIBUTE_KEYS.map((key) => [key, rating])) as VisibleAttributes
}

/** Hidden attributes with every 1–20 rating set to `rating` (CA/PA fixed at 50). */
export function flatHidden(rating: number): HiddenAttributes {
  return {
    currentAbility: 50,
    potential: 50,
    consistency: rating,
    bigGames: rating,
    injuryProneness: rating,
    professionalism: rating,
    ambition: rating,
    loyalty: rating,
    temperament: rating,
    adaptability: rating,
  }
}

/** Options for a hand-built player; anything omitted defaults to a league-average 200 cm player. */
export interface TestPlayerOptions {
  id: string
  /** Rating used for every visible attribute not listed in `attributes`. */
  rating?: number
  attributes?: Partial<VisibleAttributes>
  heightCm?: number
  consistency?: number
  lastName?: string
}

/** Builds a player with exact ratings, so tests don't depend on the random generator. */
export function makePlayer(options: TestPlayerOptions): Player {
  const heightCm = options.heightCm ?? 200
  return {
    id: options.id,
    firstName: 'Test',
    // Unique last names keep play-by-play lines unambiguous (the engine logs last names only).
    lastName: options.lastName ?? `P${options.id}`,
    measurables: {
      heightCm,
      wingspanCm: heightCm + 6,
      weightKg: 100,
      age: 26,
      dominantHand: 'right',
      nationality: 'Testland',
    },
    attributes: { ...flatAttributes(options.rating ?? 10.5), ...options.attributes },
    hidden: { ...flatHidden(10), consistency: options.consistency ?? 10 },
  }
}

/** Typical lineup heights in slot order G, G, W, W, B (matches the generator's archetypes). */
export const SLOT_HEIGHTS: readonly number[] = [191, 191, 201, 201, 210, 191, 191, 201, 210, 210]

/** Builds a team of hand-made players that all share one flat rating. */
export function makeFlatTeam(id: string, rating: number, size = 10): MatchTeam {
  const roster = Array.from({ length: size }, (_, i) =>
    makePlayer({ id: `${id}${i + 1}`, rating, heightCm: SLOT_HEIGHTS[i % SLOT_HEIGHTS.length] }),
  )
  return { id, name: `Team ${id}`, roster }
}

/** Two freshly generated average teams from one seed (ids "home" and "away"). */
export function generatedPair(seed: number): [MatchTeam, MatchTeam] {
  const rng = createRng(seed)
  return [generateTeam(rng, { id: 'home' }), generateTeam(rng, { id: 'away' })]
}

/** A copy of a player with some attributes replaced. The original is left untouched. */
export function withAttributes(player: Player, patch: Partial<VisibleAttributes>): Player {
  return { ...player, attributes: { ...player.attributes, ...patch } }
}

/** A copy of a team where one roster slot's player is replaced by `update(player)`. */
export function updatePlayer(
  team: MatchTeam,
  slot: number,
  update: (player: Player) => Player,
): MatchTeam {
  return { ...team, roster: team.roster.map((p, i) => (i === slot ? update(p) : p)) }
}

/** A copy of a team where every player gets the same attribute patch. */
export function patchTeam(team: MatchTeam, patch: Partial<VisibleAttributes>): MatchTeam {
  return { ...team, roster: team.roster.map((p) => withAttributes(p, patch)) }
}

/** A copy of a team where every player's hidden Consistency is set to `consistency`. */
export function withConsistency(team: MatchTeam, consistency: number): MatchTeam {
  const roster = team.roster.map((p) => ({ ...p, hidden: { ...p.hidden, consistency } }))
  return { ...team, roster }
}

/**
 * A copy of a team with `amount` added to the listed attributes of every player. Not clamped at
 * 20, matching tools/batch-sim.ts: balance checks measure a pure shift.
 */
export function boostTeam(
  team: MatchTeam,
  keys: readonly VisibleAttributeKey[],
  amount: number,
): MatchTeam {
  const roster = team.roster.map((player) => {
    const attributes = { ...player.attributes }
    for (const key of keys) attributes[key] += amount
    return { ...player, attributes }
  })
  return { ...team, roster }
}

/** A deep copy of a team under new ids, so the same roster can play itself without id clashes. */
export function cloneTeam(team: MatchTeam, id: string): MatchTeam {
  const roster = team.roster.map((p, i) => ({
    ...structuredClone(p),
    id: `${id}-p${i + 1}`,
    lastName: `${p.lastName}${id}`,
  }))
  return { id, name: `${team.name} (${id})`, roster }
}
