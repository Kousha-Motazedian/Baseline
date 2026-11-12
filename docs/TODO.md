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
- [ ] Add an `engines` field: `import.meta.dirname` needs Node ≥ 20.11. (`package.json`)
- [ ] Also ignore `.env`, `.env.*` and `coverage/`. (`.gitignore`)
- [ ] ESLint and Prettier ignore all of `.claude/`, but git only ignores `.claude/worktrees/`, so any `.claude/` file committed later (e.g. `settings.json`) would never be linted or format-checked. Narrow both ignores to `.claude/worktrees/`. (`eslint.config.js`, `.prettierignore`)
- [ ] A few comment lines run past the 100-column `printWidth` (Prettier doesn't wrap comments). Cosmetic. (`src/main/index.ts`, `electron.vite.config.ts`)
- [ ] The "JSDoc above every function" rule is not lint-enforced; consider `eslint-plugin-jsdoc` (`jsdoc/require-jsdoc`) — a new dependency, so ask first. (`eslint.config.js`, `CLAUDE.md`)
- [ ] `dist/` is git-ignored but not ESLint-ignored (Prettier is fine, it honours `.gitignore`); add it before a packaging step starts writing there. (`eslint.config.js`)
- [ ] Consider `noUncheckedIndexedAccess` before the array-heavy sim code grows; `pick()` already casts as if it were on. (`tsconfig.base.json`, `src/core/shared/rng.ts`)
- [ ] Folder map doesn't list `docs/` (now home of `TODO.md`). (`CLAUDE.md`)
