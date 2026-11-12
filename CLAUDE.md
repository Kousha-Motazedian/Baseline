# Baseline — Basketball Management Sim

A desktop basketball management simulation (GM/coach career game). The player builds rosters, sets tactics, and sims seasons; there is no direct on-court control.

## Stack

- Electron (desktop shell) + Vite + React + TypeScript (strict mode, no `any`)
- SQLite via `better-sqlite3` for save games (not installed yet — add it when building `src/persistence/`)
- Vitest for tests; ESLint + Prettier for lint/format
- Heavy simulation runs in a worker thread so the UI never freezes

## Commands

- Dev: `npm run dev` · Build: `npm run build`
- Test: `npm test` · Lint: `npm run lint` · Typecheck: `npm run typecheck`
- Run test, lint, and typecheck before saying a task is done.

## Architecture

- `src/core/` is the headless game logic: no UI imports, no direct I/O. The UI and persistence layers call into it, never the other way around.
- All randomness goes through the seeded RNG in `src/core/shared/rng.ts` — never `Math.random()` — so sims are deterministic for replays and bug repros.
- ESLint enforces the first two rules inside `src/core/` (no `Math.random`, no UI/Electron/fs imports).
- League rules (game length, foul limit, shot clock, cap model, roster limits) are data/config, never hard-coded.

## Folder map

Each game system lives in its own folder so it's easy to find where an aspect of the game is coded. Put new code in the folder that matches its system; if nothing fits, ask before creating a new top-level folder.

```
src/
  main/               Electron main process: windows, file system access, app lifecycle
  preload/            Secure bridge exposing a typed API (`window.baseline`) from main to the UI
  renderer/           React UI: screens, tables, inbox, match viewer (UI/UX)
  persistence/        Save/load, save versioning and migrations, compression
  core/
    calendar/         Core loop: advancing time, daily events, season phases
    career/           Game modes and roles: GM/coach roles, jobs, firing, reputation, sandbox mode
    world/            Leagues, rule configs, schedules, standings, playoffs, promotion/relegation
    players/          Attributes, hidden attributes, development/aging, morale, personality, injuries
    scouting/         Fog of war, scouts and assignments, draft scouting, analytics knowledge
    contracts/        Salary cap models, contracts, exceptions, free agency, waivers, trade rules
    draft/            Lottery, prospect generation, draft order, pick protections
    tactics/          Offensive/defensive schemes, rotations, in-game coaching decisions, training
    match/            Match engine: possession simulation, box scores, play-by-play, stats
    staff/            Coaches, scouts, trainers, medical and analytics staff
    finances/         Revenue, expenses, owner personality and objectives, facilities
    ai/               AI general managers: team strategy, trade valuation, AI free agency
    news/             News feed, media, awards, records, history, Hall of Fame
    data/             Data model types, random world generator, import/export, editor logic
    shared/           Cross-cutting helpers: seeded RNG, math/stat utilities, IDs
tools/                Dev scripts, e.g. batch-simulating seasons for balance checks
tests/                Mirrors the src/ folder structure
```

## Design docs

Game design decisions live in `docs/design/`. Read the relevant doc before implementing a system, and update it when a decision changes.

- `docs/design/player-attributes.md` — attribute list, scales, Current Ability/Potential, hidden attributes

## Code style (applies to the entire codebase, not just the engine)

- Keep functions simple and small, with one clear purpose each. Split a function when it starts doing several things.
- Every function gets a short JSDoc comment directly above it that describes its purpose:
  ```ts
  /** Calculates a player's shooting percentage from a given court zone, adjusted for defender contest. */
  function shotChance(...) { ... }
  ```
- Add comments wherever a significant logic decision is made, such as a formula choice, a probability weighting, a tie-break, or a rule interpretation. Explain _why_, not just what.
- Prefer pure functions in `src/core/`; use classes only when state genuinely requires it.
- New core logic needs unit tests; match-engine or balance changes also need a batch-sim check via `tools/`.

## Workflow

- Ask before adding a new dependency.
- Don't commit unless asked.
- Record deferred fixes and known follow-ups in `docs/TODO.md`.
