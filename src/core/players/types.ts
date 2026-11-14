import type { HiddenAttributes, Measurables, VisibleAttributes } from './attributes.ts'

/** A basketball player in the game world. */
export interface Player {
  id: string
  firstName: string
  lastName: string
  measurables: Measurables
  attributes: VisibleAttributes
  hidden: HiddenAttributes
}

/** Returns the player's display name, e.g. "Marcus Hale". */
export function fullName(player: Player): string {
  return `${player.firstName} ${player.lastName}`
}
