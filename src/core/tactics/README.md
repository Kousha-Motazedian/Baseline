# src/core/tactics

Offensive/defensive schemes, rotations, in-game coaching decisions, training.

- `system.ts`: team system settings, the balanced system, archetypes and system generation.
- `effects.ts`: what a system does to the match engine's levers (`systemEffects`).
- `fit.ts`: role/system fit per player (never reads Current Ability).
- `coaching.ts`: the engine's coaching inputs from a head coach (execution, familiarity penalty).
- `tuning.ts`: every effect size.

Design: `docs/design/coaches.md`; engine hooks: `docs/design/match-engine.md`.
