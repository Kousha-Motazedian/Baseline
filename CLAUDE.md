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
- Match sims: `npm run sim:game [-- seed]` (one game, box score) · `npm run sim:batch [-- --balance]` (league averages vs. targets, balance tests)
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
- `docs/design/match-engine.md` — match engine flow, log-odds edge model, bias fixes, calibration targets and results

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
- Every change uses two subagents, run in order:
  1. **Developer agent**: implements the change, following this file and the relevant design docs.
  2. **Tester agent**: writes/updates tests, verifies the change independently (incl. batch-sim/balance checks for engine changes), and reports issues. It does not edit `src/`; fixes go back through the developer agent.
- **Commits:** always ask the user before committing to a branch, every time, regardless of review results.
- **Pushing:** only when the user says to push to a branch. At that point (and not before), run a **final review agent on the Fable model**. It:
  1. Looks through all the changed code one last time and reports any issues it finds.
  2. Cleans up the code (style, dead code, comments, consistency with this file).
  3. Performs final testing: `npm test`, `npm run typecheck`, `npm run lint`, `npx prettier --check .`, plus `npm run sim:batch` for engine changes.
- **Triaging Fable findings** (each finding gets a severity: low, medium, high):
  - **Already in `docs/TODO.md`:** ignore it; it's already tracked.
  - **Low:** add it to `docs/TODO.md` automatically. It doesn't need fixing now and doesn't block the push.
  - **Medium or high:** notify the user so they can triage it (fix now, defer to `docs/TODO.md`, or accept). Don't push until every medium/high finding has been triaged and any fixes chosen are made and re-reviewed.
- If the Fable review finds no medium/high issues, push to the branch (asking before any commit the push needs, including one for new `docs/TODO.md` entries). Never commit or push to `main` directly.
- Record deferred fixes and known follow-ups in `docs/TODO.md`.
