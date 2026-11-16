# Baseline

**Baseline is a basketball management simulation for desktop.** You run a franchise as its general manager: build the roster through the draft, free agency and trades, hire and fire the head coach, shape how the team plays, and sim seasons to see how your decisions hold up. There is no on-court control. The games are decided by a possession-by-possession match engine driven by player attributes, roles, team systems and coaching.

Talent matters most, but it isn't everything. A well-coached team of role players who fit their system can beat a star-heavy team that doesn't, and a sharp evaluator can find good players and coaches the rest of the league overlooks.

## Releases

**No version has been released yet.** Baseline 1.0 is in development.

## Baseline 1.0 (in development)

A barebones but playable game: build a roster → set lineups → sim games → season and playoffs → draft and sign → next season.

Baseline 1.0 will include:

- **Match engine:** possession-by-possession simulation with a full foul model, fast breaks and late-game strategy, calibrated against modern pro-league averages, with box scores, play-by-play and a text match viewer.
- **Players:** attributes and hidden attributes, positions, roles and Current Ability, simple development and aging, retirements, and new players each season.
- **Head coaches:** every team has a head coach with attributes and his own playing style and system. Players' fit in the system and the coach's skill affect results. You can hire and fire coaches and override the coach's system; coaches sign contracts under a per-team coach cap set by each team's market size and owner wealth.
- **Rotations and fatigue:** players tire and recover, and the coach plans minutes and makes substitutions (foul trouble, garbage time, closing lineups), or you take over the rotation yourself. The coach also handles timeouts and end-of-game decisions.
- **League:** one pro league with a schedule, standings and playoffs.
- **Scouting:** fog of war (attributes shown as ranges that narrow with scouting), scouts and assignments, draft scouting.
- **Injuries:** in-game and practice injuries with recovery times.
- **Roster moves:** salary cap and contracts, re-signing, simple free agency, a basic draft, and basic trades with AI accept/reject.
- **AI general managers:** the other teams draft, sign, re-sign and trade on their own.
- **Inbox:** messages for injuries, contract demands, trade offers, scouting reports and draft reminders.
- **Sim controls:** sim to the next game, week, trade deadline or playoffs, stopping for important events.
- **Stats:** league leaders, and season and career stats.
- **Tutorial, save/load** and the essential screens.

## Future versions

### Baseline 2.0

- **2D match view:** a top-down court with animated players, plus shot charts.
- **Coach-only career:** run games, rotations, tactics and training while an AI GM handles roster moves. Includes getting fired, the job market and reputation.
- **Live match decisions:** call timeouts, make substitutions and change tactics while watching a game.
- **Owner goals:** owners with personalities set objectives and judge your progress.
- **Staff:** assistant coaches, trainers, medical and analytics staff.
- **Player morale and personality:** playing-time expectations, trade requests, locker-room chemistry.
- **Training:** team practice focus and individual development plans.
- **Detailed injuries:** injury types, setbacks, playing through injury, medical staff effects.
- **Deeper roster rules:** cap exceptions, luxury tax, waivers, two-way deals, pick protections, multi-team trades, agents and contract negotiation.
- **Draft extras:** lottery odds, combine and workouts.
- **League life:** news and media, awards, records and the Hall of Fame, All-Star weekend, rivalries, a development league.
- **Stats:** on/off ratings, shot charts and lineup data.
- **Retired players** become coaches and scouts.

### Baseline 3.0

- **Full team finances:** revenue, expenses, budgets, ticket prices and facilities.
- **Team sales and new owners:** owners can sell, and a new owner can make the team richer or poorer.
- **Dual GM and head coach role.**
- **European leagues** with promotion and relegation, and a continental club competition.
- **International tournaments:** national teams in world cup and Olympic-style events.
- **College basketball** as the prospect pipeline.
- **Expansion and relocation.**
- **Editor, import/export and modding** (including Steam Workshop), sandbox/commissioner mode, fantasy drafts and custom leagues.
- **Advanced analytics** such as PER and win shares.
- **Localization.**

### Baseline 4.0

- **League evolution:** play style and rules change over the decades.
- **Women's league.**

Not planned: a 3D match view and online multiplayer leagues.

## Development

Built with Electron, React and TypeScript.

- `npm run dev`: run the app
- `npm test`, `npm run typecheck`, `npm run lint`: checks
- `npm run sim:game` / `npm run sim:batch`: simulate one game or a batch of games

Design decisions live in [`docs/design/`](docs/design/), and the planned work and known follow-ups in [`docs/TODO.md`](docs/TODO.md).
