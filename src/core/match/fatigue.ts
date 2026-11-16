import type { Player } from '../players/types.ts'
import { clamp, normalizeRating } from '../shared/probability.ts'
import type { TeamSystem } from '../tactics/system.ts'
import type { GameState, TeamState } from './state.ts'
import {
  AGGRESSIVE_PRESSURE_DRAIN_FACTOR,
  ENERGY_DRAIN_PER_SECOND,
  ENERGY_RECOVERY_PER_SECOND,
  FAST_PACE_DRAIN_FACTOR,
  FATIGUE_EFFORT_SHARE,
  FATIGUE_MAX_EDGE,
  HALFTIME_RECOVERY,
  HUSTLE_EFFORT_SOFTENING,
  PUSH_TRANSITION_DRAIN_FACTOR,
  QUARTER_BREAK_RECOVERY,
  STAMINA_MAX_DRAIN_FACTOR,
} from './tuning.ts'

/**
 * In-game fatigue: each player has energy 0-100 (100 at tip-off). It drains while he is on the
 * floor, refills on the bench and at breaks, and a tired player acts worse at both ends.
 */

/** Full energy. */
export const FULL_ENERGY = 100

/** Multiplier on a team's drain from its system: intensity (pace, pushing, pressure) costs legs. */
export function systemDrainFactor(system: TeamSystem): number {
  let factor = 1
  if (system.pace === 'fast') factor += FAST_PACE_DRAIN_FACTOR
  if (system.transition === 'push') factor += PUSH_TRANSITION_DRAIN_FACTOR
  if (system.defensivePressure === 'aggressive') factor += AGGRESSIVE_PRESSURE_DRAIN_FACTOR
  return factor
}

/** Energy a player loses per second on the floor: Stamina 20 drains half as fast as Stamina 1. */
export function drainPerSecond(player: Player, systemFactor: number): number {
  // Linear in Stamina between the two documented endpoints (1 -> full rate, 20 -> half rate).
  const t = (clamp(player.attributes.stamina, 1, 20) - 1) / 19
  return ENERGY_DRAIN_PER_SECOND * (1 - (1 - STAMINA_MAX_DRAIN_FACTOR) * t) * systemFactor
}

/** A player's current energy (full if he has none recorded). */
export function energyOf(team: TeamState, player: Player): number {
  return team.energy.get(player.id) ?? FULL_ENERGY
}

/** Drains the floor and refills the bench for `seconds` of play. */
export function tickEnergy(team: TeamState, seconds: number): void {
  for (const player of team.team.roster) {
    const energy = energyOf(team, player)
    const next = team.onCourt.includes(player)
      ? energy - drainPerSecond(player, team.drainFactor) * seconds
      : energy + ENERGY_RECOVERY_PER_SECOND * seconds
    team.energy.set(player.id, clamp(next, 0, FULL_ENERGY))
  }
}

/** Gives everyone a break's worth of energy (on the floor or not: nobody plays during a break). */
export function recoverEnergy(team: TeamState, amount: number): void {
  for (const player of team.team.roster) {
    team.energy.set(player.id, clamp(energyOf(team, player) + amount, 0, FULL_ENERGY))
  }
}

/** Break recovery before the current period starts: halftime is longest, other breaks are short. */
export function applyBreakRecovery(game: GameState): void {
  if (game.period <= 1) return
  const halftime = game.period === game.rules.periods / 2 + 1
  const amount = halftime ? HALFTIME_RECOVERY : QUARTER_BREAK_RECOVERY
  recoverEnergy(game.home, amount)
  recoverEnergy(game.away, amount)
}

/**
 * The log-odds penalty (zero or negative) a player's tiredness puts on everything he does, at
 * both ends. Quadratic in the energy missing, so fresh players are almost unaffected and
 * exhausted ones are far off. Hustle softens only the effort share of it.
 */
export function fatigueEdge(team: TeamState, player: Player): number {
  const missing = (FULL_ENERGY - energyOf(team, player)) / FULL_ENERGY
  if (missing <= 0) return 0
  const effort = 1 - HUSTLE_EFFORT_SOFTENING * normalizeRating(player.attributes.hustle)
  const share = 1 - FATIGUE_EFFORT_SHARE + FATIGUE_EFFORT_SHARE * Math.max(0, effort)
  return -FATIGUE_MAX_EDGE * share * missing * missing
}

/** The lineup's average fatigue edge (used for rebounding, which is a lineup-level contest). */
export function lineupFatigueEdge(team: TeamState): number {
  if (team.onCourt.length === 0) return 0
  const total = team.onCourt.reduce((sum, p) => sum + fatigueEdge(team, p), 0)
  return total / team.onCourt.length
}
