# Known follow-ups

Deferred fixes from code reviews. Tick an item off (or delete it) when it lands; add new deferred findings here.

## Lint guards for `src/core/`

- [ ] Close import gaps: `src/core/` can still import `../../persistence/*`, `../../preload/*`, Node I/O builtins (`node:child_process`, other `node:*`) and `better-sqlite3` — extend the `no-restricted-imports` patterns. (`eslint.config.js`)
- [ ] Block non-deterministic APIs: `Date.now()`, `new Date()`, `performance.now()`, `crypto.randomUUID()` — add `no-restricted-globals` / `no-restricted-properties` rules. (`eslint.config.js`)

## Electron main process

- [ ] Navigation hardening: add `setWindowOpenHandler(() => ({ action: 'deny' }))` and a `will-navigate` guard. (`src/main/index.ts`)
- [ ] Handle rejections from `loadURL` / `loadFile` / `whenReady().then(...)` instead of leaving them unhandled. (`src/main/index.ts`)
- [ ] `ELECTRON_RENDERER_URL` is honoured in packaged builds too, so an environment variable can point the window (and its preload bridge) at any URL — only read it when `!app.isPackaged`. (`src/main/index.ts`)
- [ ] Deny web permission requests (camera, notifications, etc.) by default with `session.setPermissionRequestHandler`; the game needs none. (`src/main/index.ts`)

## Preload

- [ ] Preload type files aren't type-checked (`skipLibCheck` skips hand-written `.d.ts`): rename `api.d.ts` → `api.ts` (types only) and adjust the tsconfig `include`. (`src/preload/api.d.ts`, `src/preload/global.d.ts`, `tsconfig.*.json`)

## Seeded RNG

- [ ] Test coverage: cover `chance()` and `pick()` happy paths, and add a golden-sequence test pinning the first outputs for a fixed seed so replay-breaking algorithm changes are caught. (`tests/core/shared/rng.test.ts`)
- [ ] State save/restore, needed for save games to resume a sim deterministically. (`src/core/shared/rng.ts`)
- [ ] Input validation: NaN/fractional seeds are silently coerced; `nextInt` accepts non-integer bounds; `chance` accepts probabilities outside 0–1. (`src/core/shared/rng.ts`)

## Renderer

- [ ] CSP: add `object-src 'none'; base-uri 'self'; form-action 'none'`; dev mode relies on the React plugin's inline preamble being injected before the CSP meta tag, which is fragile. (`src/renderer/index.html`)
- [ ] Renderer bundle is unminified (~566 kB) — decide on `renderer.build.minify`. (`electron.vite.config.ts`)

## Project config

- [ ] `allowScripts` entry for `electron@45.3.0` is a no-op: Electron 45 ships no install script and downloads its binary lazily on first run (or via `npx install-electron`). Remove it, or keep it only if a future Electron reintroduces a postinstall. (`package.json`)
- [ ] Add an `engines` field: `node tools/*.ts` relies on built-in TypeScript type stripping, so require Node ≥ 22.18 (≥ 23.6 on the 23 line), not just the ≥ 20.11 `import.meta.dirname` needs. (`package.json`)
- [ ] Also ignore `.env`, `.env.*` and `coverage/`. (`.gitignore`)
- [ ] ESLint and Prettier ignore all of `.claude/`, but git only ignores `.claude/worktrees/`, so any `.claude/` file committed later (e.g. `settings.json`) would never be linted or format-checked. Narrow both ignores to `.claude/worktrees/`. (`eslint.config.js`, `.prettierignore`)
- [ ] A few comment lines run past the 100-column `printWidth` (Prettier doesn't wrap comments). Cosmetic. (`src/main/index.ts`, `electron.vite.config.ts`)
- [ ] The "JSDoc above every function" rule is not lint-enforced; consider `eslint-plugin-jsdoc` (`jsdoc/require-jsdoc`) — a new dependency, so ask first. (`eslint.config.js`, `CLAUDE.md`)
- [ ] `dist/` is git-ignored but not ESLint-ignored (Prettier is fine, it honours `.gitignore`); add it before a packaging step starts writing there. (`eslint.config.js`)
- [ ] Consider `noUncheckedIndexedAccess` before the array-heavy sim code grows; `pick()` already casts as if it were on. (`tsconfig.base.json`, `src/core/shared/rng.ts`)
- [ ] Folder map doesn't list `docs/` (now home of `TODO.md`). (`CLAUDE.md`)

## Match engine

- [ ] Overtime rate ≈ 4–5% vs. a 5–7% target after the round-3 fix pass; revisit late-game conversion once rotations/tactics exist rather than adding more end-game rules. (`docs/design/match-engine.md`, "Known off-target")
- [ ] FTA/FGA drifted to .226–.229, near the .22 floor and below the real NBA's ~.24–.25. Recover free throws through the shooting-foul rates (`BASE_SHOOTING_FOUL`) rather than `BASE_NON_SHOOTING_FOUL` (`src/core/match/tuning.ts:200`), then re-check that personal fouls per team-game stay in range. (`src/core/match/tuning.ts`, `tools/batch-sim.ts`)
- [ ] Under FIBA, a technical reached through `commitFoul` runs `updateFoulTroubleBench` twice (once in `assessTechnical`, once in `commitFoul`). Harmless (idempotent); dedupe sometime. (`src/core/match/technicals.ts:74`, `src/core/match/fouls.ts`)
- [ ] League overtime (.033–.043) is below the identical-teams rate: the generator's spread in team quality may be wider than a real league's, which pushes league overtime down. Check the generator's quality spread against a real league; realistic levers beyond that need timeouts, last-shot plays, 2-for-1s and rotations. (`src/core/data/teamGenerator.ts`, `tools/batch-sim.ts`)
- [ ] Run long test and batch jobs under `caffeinate -i` (e.g. `caffeinate -i npm run sim:batch -- --balance`): the earlier "hangs" were macOS sleeping mid-run. Consider documenting it in `tools/README.md`.
- [ ] Remove the two stopgaps once rotations exist: foul-trouble benching and caution (`src/core/match/foulTrouble.ts`, `regulars` in `state.ts`/`lineup.ts`) and blowout easing (`src/core/match/blowout.ts`).
- [ ] A block out of bounds returns `kind: 'reset'`, which `nextShotClock` treats like an offensive rebound and sets the shot clock to 14; the real rule keeps the remaining time (~2.5 times a game). Add a dedicated `NextAction` kind that keeps the clock. (`src/core/match/rebound.ts:134`, `src/core/match/possession.ts:352`)
- [ ] Fouls and turnovers can resolve after the period clock hits 0:00 (~257 non-shooting and ~56 offensive fouls per 1,000 games), awarding free throws after time expires in the bonus. A consequence of running the clock for the whole action before resolving it: skip or scale the handler-phase foul rolls when the buzzer cuts an action short, or resolve the event at a point inside the action. (`src/core/match/possession.ts:249`)
- [ ] Some rule values are hard-coded rather than `LeagueRules` data: shot values (3/2) and free throws per shooting foul (`src/core/match/shot.ts:206`), `THREE_POINTS` (`src/core/match/scoreEffects.ts:42`), one technical free throw (`src/core/match/technicals.ts:54`, `src/core/match/fouls.ts:64`), and the pro overtime jump ball tied to `quarterRotation` (`src/core/match/game.ts`). Add e.g. `threePointValue` and `technicalFreeThrows` to `LeagueRules`.
- [ ] Two exports are used only by tests: `wantsIntentionalFoul` (`src/core/match/scoreEffects.ts:203`) and `turnoverChance` (`src/core/match/turnover.ts:45`). Remove them and point the tests at `intentionalFoulPlan` and `turnoverChanceFromSkills`.
- [ ] `sim-game` seeds the team generator and the game with the same seed, so the game's first draws replay the generator's (`tools/sim-game.ts:128-130`); derive the game seed instead. In `batch-sim`, the game seed `seed * 7_919 + index` overlaps between adjacent `--seed` values once `--games` exceeds 7,919 (`tools/batch-sim.ts:303`).
- [ ] Add a golden-master engine test: pin a hash or final scores of 2–3 fixed-seed games, updated deliberately on engine changes. The determinism tests only compare a run with itself. (`tests/core/match/`)
- [ ] Technical free throws during a fast-break or post-turnover possession are counted in fast-break points and points off turnovers; exclude them. (`src/core/match/possession.ts:383`, `src/core/match/possession.ts:391`)
- [ ] **Recheck with rotations/fatigue/tactics:** individual box-score lines are far too extreme even though league averages are calibrated (1,000 average-team pro games: 41% of games have a 40+ scorer vs. ~10–16% real; 50+ games 0.068/game vs. ~0.015–0.02; team top scorer averages 33.9 pts vs. ~27–28; single-game maxima 90 pts / 32 reb / 28 ast). Causes: starters play ~38 min with no rotation, usage concentration, generator spread. Deferred because rotations/fatigue should largely fix it; when they land, add player-level targets to batch-sim (top-scorer average, 40+/50+ rates, rebound and assist leaders) and tune `USAGE_EXPONENT`, pick weights or generator spread if still off. (`src/core/match/tuning.ts:59`, `src/core/match/playSelection.ts`, `src/core/data/playerGenerator.ts`, `tools/batch-sim.ts`)
