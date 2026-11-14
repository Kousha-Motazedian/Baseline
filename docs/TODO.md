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
- [ ] The Commands section doesn't list `npm run inspect:league`. (`CLAUDE.md`)
- [ ] Folder map doesn't list `docs/` (now home of `TODO.md`). (`CLAUDE.md`)

## Match engine

- [ ] Overtime rate ≈ 4–5% vs. a 5–7% target after the round-3 fix pass; revisit late-game conversion once rotations/tactics exist rather than adding more end-game rules. (`docs/design/match-engine.md`, "Known off-target")
- [ ] FTA/FGA drifted to .226–.229, near the .22 floor and below the real NBA's ~.24–.25. Recover free throws through the shooting-foul rates (`BASE_SHOOTING_FOUL`) rather than `BASE_NON_SHOOTING_FOUL` (`src/core/match/tuning.ts:200`), then re-check that personal fouls per team-game stay in range. (`src/core/match/tuning.ts`, `tools/batch-sim.ts`)
- [ ] Under FIBA, a technical reached through `commitFoul` runs `updateFoulTroubleBench` twice (once in `assessTechnical`, once in `commitFoul`). Harmless (idempotent); dedupe sometime. (`src/core/match/technicals.ts:74`, `src/core/match/fouls.ts`)
- [ ] League overtime (.042–.048 after the roles round; seed 1: .044) sits around the identical-teams rate (.037–.054): the generator's spread in team quality may be wider than a real league's, which pushes league overtime down. Check the generator's quality spread against a real league; realistic levers beyond that need timeouts, last-shot plays, 2-for-1s and rotations. (`src/core/data/teamGenerator.ts`, `tools/batch-sim.ts`)
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

## Players: roles, positions and CA

- [ ] **CA 90+ players can end up with one role** (~0.3%, e.g. SG-only CA 91–97 with Lockdown Defender first), breaking the rule "CA 90+ always has 2 roles". `contradicts()` uses `leadingSkill()`, which arbitrarily returns `driving` for equal-weight broad templates, so Lockdown Defender's `weakAt` blocks All-Around and every scoring role. Fix: never treat broad templates (All-Around, Two-Way Forward) as contradicted via `leadingSkill`, and for CA 90+ fall back to the best non-identical role. Then change the `roles.test.ts` test "gives a GOAT one role when no distinct second role exists" and add a regression test (`areDistinctRoles('Lockdown Defender', 'All-Around')` is true; every CA 90+ player in 400 leagues holds 2 roles). The `leagueTalent.test.ts` 90+ check passes only by seed. (`src/core/players/roles.ts`, `docs/design/player-roles.md`)
- [ ] The balance section of `sim:batch` is noisier with star-heavy league teams: fresh seed 5151 gives an offense:defense ratio of 1.28 (target 1.30–1.50; 1.40 on the old generator, 1.42 with `--average`). Not an engine regression. Run the balance pairs on average teams or with more games. (`tools/batch-sim.ts`)
- [ ] CA jumps at a hard height limit when a new position becomes eligible (e.g. an extreme inside player goes from CA 74 at 200 cm to 85 at 201 cm, once C is allowed). CA is continuous in attributes and height is fixed, so this only matters for the editor or any future height change. (`src/core/players/currentAbility.ts`)
- [ ] A few marginal role labels: a 197 cm PG/SG/SF "Point Forward" with Passing and Ball Handling at exactly 10; a PG "Lockdown Defender" whose Passing (15) beats his Perimeter Defense (11); a PF/C "Playmaking Big" at Passing exactly 10. Rare; revisit if users notice. (`src/core/players/roles.ts`)
- [ ] Positions played can list an outer position while skipping a bridged middle one that rates lower (e.g. PG 8.5 / SG 7.2 / SF 7.5 gives PG/SF, since SF ranks ahead of SG and SG passes the 1.5 skip margin). It follows the approved rule and only reads oddly on weak bench players. (`src/core/players/positions.ts`)
- [ ] At 206 cm every position is height-eligible, so a few low-CA players with near-equal ratings list PG and C together (PG/PF/C, SG/C, SG/SF/C: ~0.04 per league). Follows from the height limits; revisit if it shows up in play. (`src/core/players/positions.ts`)
- [ ] Stored `hidden.currentAbility` will go stale once development, aging or injuries change attributes (the doc says nothing is stored). Recompute it on every attribute change, or drop the field and always call `currentAbility()`. (`src/core/data/playerGenerator.ts:212`)
- [ ] Two engine sensitivity thresholds were loosened for the new average teams: rim-attack share 0.06 → 0.04 and Passing → assisted share 0.05 → 0.025 (now about half the measured +.04–.06 effect). Re-tighten with more games per series, or when rotations land. (`tests/core/match/sensitivity.test.ts:147`, `:189`)
- [ ] Age is independent of CA, so a 19- or 37-year-old GOAT is as likely as a 27-year-old one. Bias age toward the prime for high CA when development and aging are built. (`src/core/data/playerGenerator.ts:174`)
- [ ] `fitLevel`'s exact-target guarantee assumes attributes tick up one at a time; two thresholds within the bisection resolution (~3e-6) could skip a CA value. Negligible (0 misses in 27,000 players); optionally note or assert it. (`src/core/data/playerGenerator.ts:124-141`)
- [ ] League generation test gaps: no direct tests of `drawLeagueAbilities` above 30 teams or of the overflow/slice path with tiny rosters, no `generateLeague` determinism test, and the "about three players per position" / "one starter per position" assertions are loose. (`tests/core/data/leagueTalent.test.ts`, `tests/core/data/teamGenerator.test.ts`)
- [ ] The GOAT cap scales with league size (band counts scale above 30 teams, so a 60-team league can have up to 4 GOATs); say so in `docs/design/player-roles.md`. (`src/core/data/leagueTalent.ts:85`)
- [ ] `numberArg` is duplicated in `tools/inspect-league.ts` and `tools/batch-sim.ts` (share a `tools/args.ts`), and `useAverageTeams` in `batch-sim.ts` is a module-level mutable flag (pass it as a parameter). (`tools/`)
- [ ] FIBA 12-man rosters split into units of 5/5/2, so each team's last two bench spots get random positions. Fine for now; revisit with roster building and the draft. (`leagueRosterSpots` in `src/core/data/teamGenerator.ts`)

## Performance (future)

Not needed yet. Do these only when simulation speed becomes a real problem (e.g. simming a full season with every league is too slow). If they are not enough, see the Rust port under Future features.

- [ ] Run each sim day's games in parallel across worker threads (games are independent; ~6–8× on an 8-core machine, no rewrite).
- [ ] Profile the engine and fix hot spots in TypeScript (e.g. per-possession object allocation).

## Baseline 1.0 scope

Barebones but playable: the core loop is build a roster → set lineups → sim games → season and playoffs → draft and sign → next season. Anything not listed here is a future feature (below).

- **League:** one pro league, schedule, standings, playoffs.
- **Players and teams:** generated players and teams, roles and positions, simple development and aging, retirements and replacement players generated each season.
- **On court:** match engine, text match viewer, box scores and season stats.
- **Coaching:** rotations and fatigue, basic tactics, and **hireable head coaches**. Every team has a head coach with attributes and their own playing style and system; you can hire and fire your team's head coach. Coaches have salaried contracts under a per-team coach cap until full staff finances arrive (see `docs/design/coaches.md`). The coach's system is the team's default tactics; you can override it (details in the coach design doc).
- **Your role:** you are the GM. Overriding tactics is a GM perk, not a separate coaching job; coach-only careers come in 2.0 and the dual GM + coach role in 3.0.
- **Scouting:** fog of war (attributes shown as ranges, narrowing with scouting), scouts and assignments, draft scouting. Scouts and head coaches are the only staff in 1.0.
- **Injuries:** in-game and practice injuries with "out X games" recovery times and injury proneness; no medical staff effects yet.
- **Roster moves:** salary cap and contracts (re-signing, simple free agency), a basic draft, basic trades with AI accept/reject.
- **AI GMs:** the other teams draft, sign, re-sign and trade on their own so the league stays alive season to season. (`src/core/ai/`)
- **Inbox:** messages for injuries, contract demands, trade offers, scouting reports and draft reminders. 2.0's news and media build on it. (`src/core/news/`, `src/renderer/`)
- **Sim controls:** sim to the next game, week, trade deadline or playoffs, stopping for important events. (`src/core/calendar/`)
- **Stats pages:** league leaders, and season and career stats for each player.
- **Tutorial:** a simple guided start for new players.
- **Infrastructure:** save/load and the essential screens.

## Future features

Planned features beyond the current work, tagged by release.

- [ ] **2D match view (Baseline 2.0):** a top-down court with player tokens animated from the play-by-play events, plus shot charts. The viewer acts out events; the engine stays abstract (no per-player court coordinates) so simulation speed is unaffected. (`src/renderer/`)
- [ ] **Owner goals (Baseline 2.0, financial goals in 3.0):** owners with personalities set season and long-term objectives and review the user's progress against them, tied to job security and patience. In 2.0 the goals are based only on team performance (e.g. make the playoffs, win a round, develop young players, win now). Financial goals (cut payroll, turn a profit, budgets) arrive in 3.0 with full team finances. (`src/core/career/`, `src/core/finances/`)
- [ ] **Staff (Baseline 2.0):** hiring assistant coaches, trainers, medical and analytics staff (scouts and head coaches are already in 1.0), with effects on development, injuries and tactics. (`src/core/staff/`)
- [ ] **Detailed injuries (Baseline 2.0):** injury types and body parts, recovery timelines with setbacks, playing through injury, and medical staff effects on prevention and recovery. 1.0 has simple out-X-games injuries. (`src/core/players/`)
- [ ] **Player morale and personality (Baseline 2.0):** playing-time and role expectations, complaints and trade requests, locker-room chemistry, using the hidden personality attributes. (`src/core/players/`)
- [ ] **Training (Baseline 2.0):** team practice focus and individual development plans. (`src/core/tactics/`, `src/core/players/`)
- [ ] **Advanced contract rules (Baseline 2.0):** cap exceptions, luxury tax, waivers, two-way deals, rookie-scale details. (`src/core/contracts/`)
- [ ] **Advanced trades (Baseline 2.0):** pick protections, multi-team trades, trade-deadline AI behaviour. (`src/core/contracts/`, `src/core/ai/`, `src/core/draft/`)
- [ ] **Draft extras (Baseline 2.0):** lottery with odds, combine measurements, workouts. (`src/core/draft/`)
- [ ] **News and media (Baseline 2.0):** news feed, press conferences, media pressure. (`src/core/news/`)
- [ ] **Awards, records and history (Baseline 2.0):** MVP and other awards, all-league teams, record books, Hall of Fame. (`src/core/news/`)
- [ ] **Career depth (Baseline 2.0):** a coach-only career option (you run games, rotations, tactics and training while an AI GM handles roster moves), getting fired, the job market, reputation. Pairs with owner goals. (`src/core/career/`)
- [ ] **Development league (Baseline 2.0):** a minor-league affiliate for stashing and developing players. (`src/core/world/`)
- [ ] **All-Star weekend (Baseline 2.0).** (`src/core/world/`)
- [ ] **Live match decisions (Baseline 2.0):** while watching the text match viewer, call timeouts, make substitutions and change tactics in real time. (`src/core/match/`, `src/core/tactics/`, `src/renderer/`)
- [ ] **Agents and contract negotiation (Baseline 2.0):** player agents with personalities, counteroffers and holdouts. (`src/core/contracts/`)
- [ ] **Basic stats and analytics (Baseline 2.0):** on/off ratings, shot charts and lineup data. (`src/core/match/`, `src/renderer/`)
- [ ] **Retired players become coaches and scouts (Baseline 2.0):** former players enter the staff pool. (`src/core/staff/`)
- [ ] **Rivalries (Baseline 2.0):** history-driven rivalries that affect the Big Games attribute, crowd effects and owner expectations. (`src/core/world/`)
- [ ] **Rust engine (Baseline 2.0 or 3.0):** port the match engine core (`src/core/match/`) to Rust compiled to WebAssembly (or a napi-rs native addon), expected ~3–10× faster than TypeScript. Must stay bit-for-bit deterministic: port the mulberry32 RNG and floating-point math exactly, and verify by running both engines on the same seeds and comparing results game by game (e.g. a results hash, like the final review's 600-game check) so saved replays don't change.
- [ ] **Full team finances (Baseline 3.0):** revenue (tickets, TV, merchandise, sponsorship, playoff gates), expenses (salaries, staff, facilities, travel), budgets and profit/loss, ticket pricing, and facility upgrades. Baseline 1.0 and 2.0 model only the salary cap and payroll rules. Firing a coach early becomes costly here: his remaining salary keeps counting against the team's budget until his contract ends (in 1.0/2.0 firing is free under the coach cap). Adds financial owner goals (see Owner goals). (`src/core/finances/`)
- [ ] **European leagues (Baseline 3.0):** playable European domestic leagues and a continental club competition alongside the pro league. Builds on the existing FIBA rule set (`FIBA_RULES`) and needs the systems a European setup implies: promotion/relegation, import-player limits, club-specific finances, and scheduling domestic and continental games together. (`src/core/world/`, `src/core/contracts/`, `src/core/finances/`)
- [ ] **International best-on-best tournaments (Baseline 3.0):** national-team competitions in the style of a world cup and an Olympic tournament. Needs national-team selection (uses the `nationality` measurable), national-team GM and head coach jobs that a career can hold at the same time as a club job (as a club head coach can also coach a national team), national-team call-ups, qualifying windows and tournament calendars that fit around club seasons, and FIBA rules for the games. (`src/core/world/`, `src/core/career/`, `src/core/calendar/`)
- [ ] **Editor and import/export (Baseline 3.0):** edit players and teams; import and export databases (e.g. community-made real-player files). (`src/core/data/`)
- [ ] **Sandbox / commissioner mode (Baseline 3.0):** edit anything and change league rules mid-save. (`src/core/career/`)
- [ ] **Fantasy draft and custom league setup (Baseline 3.0).** (`src/core/world/`, `src/core/draft/`)
- [ ] **College basketball (Baseline 3.0):** college teams and seasons as the prospect pipeline. (`src/core/world/`, `src/core/draft/`)
- [ ] **Expansion and relocation (Baseline 3.0):** league expansion with expansion drafts (protected lists, picks from existing rosters) and franchise relocation (new city, name and market, with effects on finances and fan base). (`src/core/world/`, `src/core/draft/`, `src/core/finances/`)
- [ ] **Dual GM and head coach role (Baseline 3.0):** a career can hold both jobs at once, running roster moves and coaching together, with its own expectations from the owner. 1.0 has the GM role and 2.0 adds the coach-only role (see Career depth). (`src/core/career/`)
- [ ] **Advanced analytics (Baseline 3.0):** advanced metrics such as PER and win shares, building on 2.0's basic analytics. (`src/core/match/`, `src/renderer/`)
- [ ] **Localization (Baseline 3.0):** the game in other languages. (`src/renderer/`)
- [ ] **Steam Workshop / modding support (Baseline 3.0):** building on the editor and import/export. (`src/core/data/`)
- [ ] **League evolution (Baseline 4.0):** play style changes over decades (e.g. more threes) and league rule-change votes, so long saves don't feel frozen in time. (`src/core/world/`)
- [ ] **Women's league (Baseline 4.0):** a separate playable women's league. (`src/core/world/`, `src/core/data/`)
- Not planned: a 3D match view; online multiplayer leagues.
