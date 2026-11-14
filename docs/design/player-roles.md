# Player Roles, Positions and Current Ability

Design reference for how the game describes what a player _is_: which positions they can play, what role they fill, and how good they are overall. Code will live in `src/core/players/`. Builds on [player-attributes.md](player-attributes.md).

**Status:** agreed for the first implementation.

## Why this comes before coaches and tactics

Rotations need to know who can back up whom ("who covers the 5 when the center sits?"), and tactics need to know who fills a job ("who is my rim protector?"). A depth chart also needs one comparable "how good is he" number. None of this exists yet: the generator builds players from a rough guard/wing/big archetype, and Current Ability is a placeholder (the mean of all 30 attributes).

## Principles

- **Nothing here is stored.** Positions, roles and CA are all _computed_ from attributes and measurables, so they stay correct automatically as players develop, age or get injured.
- **The match engine doesn't read any of it.** The engine keeps simulating from attributes. Positions and roles are for people and for decision-makers: the UI, coaches (rotations, tactics), AI GMs, scouting and contracts.
- **CA never affects how well a player simulates.** The match engine works only from attributes (and, once tactics exist, how well a player's role fits the system). CA is a reputation/valuation number. It can influence decisions people make (coaches' minutes and tactics, AI GMs, contracts, media), but never the simulation itself. Example: the 2010s Atlanta Hawks had no real superstar and won through system and tactics.
- **Labels describe, they don't restrict.** Any player can be played anywhere; playing out of position simply means their attributes fit the job worse. The hard height limits below only decide which positions a player is _listed_ at.

## 1. Positions

### Position ratings

Every player gets a **fit rating for each of the five positions (PG, SG, SF, PF, C) on the 1–20 scale**. A position rating is a weighted average of the attributes that matter for that position, plus a measurables modifier, mainly height.

| Position | Weighted attributes (heaviest first)                                                                             | Body                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| PG       | Ball Handling, Passing, Offensive IQ, Quickness, Speed, Three-Point, Perimeter Defense, Stealing                 | Shorter is fine; very tall is a mild penalty                         |
| SG       | Three-Point, Mid-Range, Driving, Off-Ball Movement, Ball Handling, Perimeter Defense, Quickness                  | Guard height                                                         |
| SF       | Perimeter Defense, Driving, Three-Point, Finishing, Off-Ball Movement, Strength, Defensive Rebounding            | Wing height and length                                               |
| PF       | Interior Defense, Defensive Rebounding, Strength, Finishing, Post Scoring, Three-Point (stretch value), Vertical | Forward height                                                       |
| C        | Interior Defense, Shot Blocking, Defensive and Offensive Rebounding, Strength, Finishing, Vertical               | Height and wingspan matter most; short centers are heavily penalised |

The exact weights are tuning data that live in code, not in this doc. **Inside a position's height range, height works on a soft curve, not a cutoff:** a 6'7" player with elite rebounding and interior defense can rate as a decent small-ball center, but never as a great one.

### Hard height limits

On top of the soft curve, each position has a hard height range (actual height, inclusive). Outside it, a player can never have that position as primary or among his positions played, whatever his skills; his rating there shows as 0 ("ruled out by height"). The generator always gives a player a height inside the range of the position he is built for.

| Position | Lowest        | Highest        |
| -------- | ------------- | -------------- |
| PG       | 175 cm (5'9") | 206 cm (6'9")  |
| SG       | 185 cm (6'1") | 206 cm (6'9")  |
| SF       | 193 cm (6'4") | 208 cm (6'10") |
| PF       | 198 cm (6'6") | 213 cm (7'0")  |
| C        | 201 cm (6'7") | 229 cm (7'6")  |

Why hard limits as well as the curve: with the curve alone, skills could outweigh size (a 6'3" rebounder listed as a C), which no coach would do. The ranges cover what modern pro leagues actually field at each spot, with overlap so versatile players keep two positions. A player shorter or taller than every range (under 175 cm or over 229 cm) is judged as 175 or 229 cm, so he still has a position. CA only considers the positions a player's height allows.

### What the UI shows

- **Primary position:** the highest position rating.
- **Positions played:** the primary position plus any other height-eligible positions that rate close to it. They are taken in rating order: the first extra position must be within **1.2 points** of the best, a second within 0.6, a third within 0.4 and so on (the nth extra position needs to be within 1.2 / n). They are shown in PG→C order, e.g. "PG/SG", "SF/PF", or "PG/SG/SF" for a 6'9" playmaker. This is how versatility shows up.
  - Positions **don't have to be adjacent**, but a skipped middle position must rate within **1.5 points** of the best: anyone listed PG/SF is at least a passable SG. PG/SF stays rare: about 2.7 players per league (2.65 measured over 20 leagues).
  - _Changed from the first draft's flat 2-point margin_, which made 80% of a generated league multi-position and 19% three-position. Now about half the league is dual-eligible and under 3% play three positions, close to a real league.
- **Position ratings** for all five positions on the player screen, so the user can see "a 14 at SF, but only a 9 at PF".

Five traditional positions (not a guard/wing/big split): they are what basketball fans read, a depth chart needs that granularity, and "positions played" already handles positionless players.

## 2. Roles

A role is a short label for **how** a player plays, e.g. "3-and-D Wing" or "Rim Runner". Each role is a template: weighted attributes plus optional measurable requirements. The player gets the role with the best template fit among the roles for their positions played.

A label must never contradict the ratings: a "Stretch Big" must actually shoot, and a "Playmaking Big" must actually pass. Each role therefore has defining skills that must reach about league average (10 on the 1–20 scale), and a second role must describe a _different_ strength from the first (see Implementation notes).

### How many roles a player has

A second role marks a player who is elite in two different ways, so it's reserved for the very best:

| CA                       | Roles                                                        |
| ------------------------ | ------------------------------------------------------------ |
| 90+ (Generational, GOAT) | **Always 2:** the two best-fitting distinct roles            |
| 80–89 (Superstar)        | **Usually 1.** About **10%** of superstars get a second role |
| Below 80                 | 1                                                            |

Superstars get a second role only when it fits almost as well as their first. The closeness threshold is tuned so that about 10% of generated superstars qualify. That way the second role still means something ("he really does both") instead of being a random 1-in-10 roll, and it stays computed, never stored.

Role list:

| Role              | Positions | What defines it                                                               |
| ----------------- | --------- | ----------------------------------------------------------------------------- |
| Floor General     | PG        | Passing, Offensive IQ, Ball Handling; scoring secondary                       |
| Scoring Guard     | PG, SG    | Driving, Mid-Range/Three-Point, Ball Handling                                 |
| Sharpshooter      | SG, SF    | Three-Point, Off-Ball Movement, Free Throw                                    |
| Slasher           | SG, SF    | Driving, Finishing, Quickness, Vertical                                       |
| 3-and-D Wing      | SG, SF    | Three-Point plus Perimeter Defense, Stealing                                  |
| Lockdown Defender | PG–SF     | Perimeter Defense, Quickness, Stealing, Defensive IQ; weak scoring            |
| Point Forward     | SF, PF    | Passing, Ball Handling at forward size                                        |
| Two-Way Forward   | SF, PF    | Balanced scoring, defense and rebounding                                      |
| Stretch Big       | PF, C     | Three-Point/Mid-Range at big size                                             |
| Post Scorer       | PF, C     | Post Scoring, Strength, Finishing                                             |
| Rim Runner        | PF, C     | Finishing, Vertical, Offensive Rebounding, Speed; limited skill               |
| Rim Protector     | PF, C     | Shot Blocking, Interior Defense, Defensive Rebounding                         |
| Playmaking Big    | PF, C     | Passing and Offensive IQ at big size                                          |
| All-Around        | any       | Strong across the board with no single dominant trait (stars often land here) |

Roles are **descriptive only for now**. When tactics arrive, a coach can ask for a role in a scheme (e.g. "this system wants a Rim Protector at the 5"). That's also when we can revisit whether players need explicit tendencies.

## 3. Current Ability (CA)

### How it's calculated

CA replaces the placeholder with the **role-weighted budget** described in player-attributes.md:

1. For each position, compute an **ability score**: a weighted average of the attributes using that position's **CA weights**. These are similar to the position-rating weights, but cover _everything_ that wins games at that position, including Offensive IQ, Defensive IQ, Composure and Teamwork.
2. Each position's score is discounted for how badly the player's body fits it (the position's body factor, softened: raised to the power 0.5).
3. **The player's CA is his best body-adjusted ability score over the positions his height allows** (in practice almost always his primary position), mapped onto 1–100.

_Changed from the first draft's "the ability score at the primary position"._ That made CA jump when the primary position flipped: one more point of Finishing could turn a C into a PF and cost him 2 CA, and the generator then missed targets. The best over positions is continuous and never falls when an attribute rises, so the generator hits every target exactly.

Some attributes don't count toward CA, because they don't make a player better on the court today:

- **Excluded:** Work Ethic (development), Leadership (morale), plus all hidden attributes (Consistency, Big Games and the rest).
- **Light weight:** Stamina and Durability. They matter over a season more than within a possession.

Leadership is deliberately excluded: CA measures on-court ability, and AI GMs can value a player's locker-room influence separately.

### Calibrating the 1–100 scale

The mapping from ability score to CA is calibrated so that a generated pro league matches the tier table in player-attributes.md. Targets for a 30-team league with about 450 rostered players. Bands are exclusive, so each player counts in exactly one row:

| CA    | Tier                  | Players in the league      |
| ----- | --------------------- | -------------------------- |
| 100   | GOAT                  | 0–2 (usually 0; see below) |
| 90–99 | Generational          | 1–3                        |
| 80–89 | Superstar             | ≈ 5–8                      |
| 70–79 | All-Star              | ≈ 20–30                    |
| 60–69 | Quality starter       | ≈ 90–120                   |
| 50–59 | Rotation player       | ≈ 150–180                  |
| 40–49 | End of bench / fringe | the rest                   |

**GOAT frequency.** A GOAT should emerge about **once every 20–30 seasons**: Jordan, Kobe and LeBron came in back-to-back eras, so "once a century" is too rare. A GOAT sits at 100 for only a few peak seasons, so at any given moment there is usually no GOAT in the league. For a newly generated league, the targets are:

- **0 GOATs:** about 75–80% of leagues.
- **1 GOAT:** about 20%.
- **2 GOATs:** about 2% at most.

0 must always be far more common than 2. Once development exists, the season loop should reproduce the same one-every-20–30-seasons rate. That's a check for later.

A test generates many leagues and checks this distribution.

### The budget rule (generation now, development later)

- **Generation:** the generator picks a **target CA and a primary position**, generates attributes with that position's shape, then scales them up or down until the computed CA hits the target. So "generate a CA 72 center" produces a coherent All-Star center, instead of random numbers that happen to average high.
- **Development (later, not in this step):** growth adds CA, spread over attributes according to age, training focus and position weights; decline removes it. That system belongs to the season loop and comes later.

## 4. Generator changes

- Replace the guard/wing/big archetype with **position-based generation**: PG, SG, SF, PF and C attribute shapes plus body templates. The existing guard/wing/big biases become the starting point for these.
- **Team generation** builds a realistic roster: about 2–3 players per position across 13–15 players, and a CA spread such as one or two stars, starters around 60–68, and a bench of 45–58.
- **Engine recalibration risk:** changing the generator changes the players every batch sim uses. The engine's targets must still pass afterwards, which the tester will check.
- **Fable's deferred box-score finding** (the extreme stat lines) partly comes from the generator's player-quality spread. Watch it here, but the main fix is still rotations.

## 5. Out of scope for this step

- Development, aging and Potential drift (season loop).
- Explicit tendencies (tactics).
- Depth charts and rotations (the rotations step); they will _use_ position ratings.
- Scouting fog of war over positions, roles and CA (scouting).

## 6. Implementation notes

Code: `src/core/players/positions.ts` (position ratings, height limits, positions played, position profiles), `roles.ts` (role templates, fits, distinct pairs, role count), `currentAbility.ts` (CA weights, score → CA mapping, tiers); `src/core/data/leagueTalent.ts` (league CA pool and dealing), `playerGenerator.ts`, `teamGenerator.ts`. Inspect a generated league with `npm run inspect:league` (see `tools/README.md`).

- **Position ratings.** Skill = weighted average of the position's attributes (`POSITION_WEIGHTS`). The body factor (0–1] then scales the rating's distance above 1: `rating = 1 + (skill − 1) × bodyFactor`. Multiplicative, so a badly sized player can't be great at a position whatever his skills: a 6'7" center with 20s everywhere tops out around 13. The factor uses an "effective height" (height plus part of any wingspan beyond +7 cm; wingspan counts most for C) and a smooth bell-shaped penalty outside each position's ideal range. The steepest slope is under 6% per cm, so there is no cliff inside a height range. At each hard limit a player with 15s everywhere still rates about 10–14, so the curve meets the limits gently. Outside the limits the rating is 0. Ratings are kept unrounded; the UI rounds.
- **Tall guards.** The tall side of PG is mild: no penalty up to 196 cm effective height, at most −30% far beyond. SG's tall side is never harsher than PG's (ideal up to 200 cm, same gentle tail), because height is at least as welcome at SG as at PG; a test checks this from 196 to 206 cm. The tested tall-playmaker profile ("keeps a 6'7" elite playmaker a PG" in `tests/core/players/positions.test.ts`) gives:
  - PG with CA 84 at 188 cm;
  - PG/SG with CA 82 at 201 cm and CA 80 at 203 cm;
  - PG/SG with CA 77 at the PG maximum of 206 cm, where SG edges ahead as primary (13.56 vs 13.40).
    Why it matters: when SG's tall side was harsher than PG's, mediocre 199–204 cm bench players were listed PG/SF (about 23 per league).
- **Positions played** use a shrinking margin in rating order, with no adjacency requirement but a 1.5-point floor for skipped middle positions (section 1).
- **Position profiles** (`POSITION_PROFILES`): the typical attribute shape at each position. The generator builds players from it, and roles are judged against it (below), so the two can't drift apart.
- **Role fit.** Each role's fit is the template's weighted average, measured relative to a typical player at the role's position, then adjusted:
  - _Norm position:_ the position used is the role's own position nearest the player's primary one, so an SF is a Rim Protector only if he protects the rim like a typical PF. Roles not open to the primary position also lose 0.5. On raw numbers nearly every center was a Rim Protector and none a Stretch Big; relative fits make the role say what stands out about this player.
  - _Skill floor:_ each role's defining skills (e.g. Three-Point for Stretch Big, Passing for Playmaking Big) cost 3 fit points per point below 10, so labels don't contradict the ratings. The broad roles (All-Around, Two-Way Forward) apply the floor to their template average.
  - _Weak side:_ Lockdown Defender and Rim Runner lose fit when their "weak" side (scoring; perimeter/post skills) is within 3 points of their core.
  - _Broad bonus:_ All-Around (+0.4) and Two-Way Forward (+0.5) get a bonus, because the best of a dozen narrow templates always stands out a little by chance.
- **Distinct second roles.** Roles belong to families (playmaking, shooting, finishing, perimeter defense, ...). A second role must share no family with the first and must not contradict it, e.g. a Rim Runner is expected not to shoot, so Rim Runner + Stretch Big is no pair. The second role is the best distinct runner-up.
- **CA.**
  - _Weights:_ a baseline weight for every on-court attribute (Offensive/Defensive IQ 1.5, Stamina/Durability 0.4, Aggression 0.5, Work Ethic and Leadership 0), plus the position-rating weights, so a position's key skills count several times more.
  - _Score:_ the ability score is the CA-weighted average at a position, discounted by the body factor to the power 0.5. CA uses the best score over height-eligible positions: `CA = 50 + (score − 9.45) × 7.5`, rounded and clamped to 1–100. CA 100 needs an ability score of about 16.1.
  - _One step per point:_ one attribute point moves the unrounded CA by at most 0.93 (`CA_MAX_STEP`, guarded by a test). That is what lets the generator hit every target exactly.
- **Talent pool.** A league's CAs are drawn per tier band (GOAT count 0/1/2 with 78/20/2%, Generational 1–3, Superstar 5–8, All-Star 21–29, Quality starter 95–115, Rotation 155–175), skewed towards the bottom inside each band. The fringe band 40–49 fills the rest, skewed towards its top. Drawing counts per league (not per player) is what guarantees "never more than 2 GOATs". The sorted pool is dealt in rounds of one player per team, each round in a fresh random team order, so every team has one of the league's 30 best players, one of the next 30, and so on.
- **Rosters.** Roster size is league-rules data (`LeagueRules.rosterSize`: pro 15, FIBA 12). A pro team is three units of five (starters, two bench units), with one player per position in each unit, positions shuffled inside the unit, then put in PG–C order. The starters are the five best players, in the engine's lineup-slot order. Leagues larger than the 30-name pool get numbered team names.
- **Generation to a target CA.** Position body template (height redrawn until inside the position's limits) → shape (centered profile + per-attribute noise, SD 2) → bisection on the level that makes the computed CA hit the target. Leadership and Work Ethic are drawn independently of the level (they don't count toward CA). The stored CA is the computed one. Potential is unchanged: CA plus up to 3 × (27 − age) headroom.
- **Average teams.** `generateTeam(rng, { id, averageCa })` builds a uniform, star-free team (starters around `averageCa`, SD 7; bench 12 lower). `AVERAGE_TEAM_CA = 67` reproduces the old generator's average team (starters' mean visible rating 10.5, bench 9.0). `npm run sim:batch -- --average` uses these.
- **The engine is unaffected by design.** Nothing in `src/core/match/` reads CA, Potential, positions or roles (a test checks both the source and identical results when CA/PA are scrambled). CA only steers the generator's attribute levels; the engine sees attributes.

### Calibration results

Measured with `npm run inspect:league -- --leagues 1000` (30 teams × 15 = 450 players per league):

| Tier            | Target    | Mean per league | Range in every league |
| --------------- | --------- | --------------- | --------------------- |
| GOAT            | 0–2       | 0.24            | 0–2                   |
| Generational    | 1–3       | 1.98            | 1–3                   |
| Superstar       | ≈ 5–8     | 6.53            | 5–8                   |
| All-Star        | ≈ 20–30   | 25.04           | 21–29                 |
| Quality starter | ≈ 90–120  | 105.0           | 95–115                |
| Rotation player | ≈ 150–180 | 165.0           | 155–175               |
| End of bench    | the rest  | 146.2           | the rest              |

Every player's computed CA equals his target, so these ranges hold exactly.

- **GOAT frequency:** 0 GOATs in 78.1% of leagues, 1 in 20.0%, 2 in 1.9%, never more.
- **Roles:** superstars with two roles 10.1% (closeness threshold 0.085 fit points). Generational and GOAT players get two distinct roles whenever a distinct runner-up exists (a rare 90+ player with only one is a known, deferred issue in docs/TODO.md); everyone below 80 has one. Most common role per primary position (20 leagues):
  - PG: Floor General 41%, Scoring Guard 25%, All-Around 14%, Lockdown Defender 13%
  - SG: Sharpshooter 26%, Scoring Guard 20%, 3-and-D 20%, All-Around 12%, Slasher 11%
  - SF: Two-Way Forward 21%, Slasher 17%, Sharpshooter 14%, 3-and-D 12%, Lockdown Defender 12%
  - PF: Post Scorer 27%, Rim Protector 18%, Stretch Big 16%, Two-Way Forward 12%, Rim Runner 12%
  - C: Rim Protector 31%, Post Scorer 26%, Rim Runner 22%
- **Label honesty:** no holder of a role is at 7 or below in a defining skill. The worst case is Stretch Big: 7% sit at 3PT 9, against a league mean of 9.4.
- **Positions:**
  - Primary positions per league are about PG 100, SG 96, SF 71, PF 88, C 95.
  - Positions played: 43% one position, 54% two, 2.6% three or more.
  - The most common lists are PF/C 18%, PG 16%, PG/SG 14%, SG/SF 12%, C 11%, SF/PF 9%.
  - Non-adjacent lists are 1.0% of players: PG/SF about 2.7 per league, PG/SF/PF 0.6, PG/PF 0.1. PG and C never appear in the same list.
- **Attribute levels:** league starters average a visible rating of 10.54 (bench 8.99), matching the old generator's average team (10.5 / 9.0). Mean visible rating by tier: Generational ≈ 14.3, Superstar ≈ 12.4, All-Star ≈ 11.8, Quality starter ≈ 10.1, Rotation ≈ 9.0, End of bench ≈ 7.8.
- **Engine:** `npm run sim:batch -- --balance` passes every target on seeds 1, 2, 3 and 11 except the known overtime gap. League overtime is .042–.048 and identical-team overtime .037–.046. Seed 7 also shows an offense : defense ratio of 1.52 at the default 2,000 balance games. That is sampling noise: over 8,000 paired games seed 7 measures 1.41, and the other seeds measure 1.33–1.42. No engine constants were changed.
- **Box-score watch (league teams vs. the old generator):** a 40+ scorer in 42–45% of games (old 37–41%), 50+ in 12–13% (old ≈ 7.5%), team top scorer 35.1–35.4 pts (old ≈ 34). Stars make the extreme lines a little more extreme. As expected, rotations remain the main fix (docs/TODO.md).
