# src/core/staff

Coaches, scouts, trainers, medical and analytics staff.

- `types.ts`: head coach model (attributes, hidden Reputation and Adaptability, contract).
- `coachGenerator.ts`: random head coaches built around one quality level, with archetype leans.
- `contracts.ts`: salary demands, contract lengths and coach-cap accounting.
- `market.ts`: the coach market (head coaches by team plus the unemployed pool) and league setup.
- `hiring.ts`: firing, hiring, AI hiring (never the coach a team itself fired) and the AI firing rule (pure functions).

Design: `docs/design/coaches.md`.
