# Match Engine

Design reference for the possession-by-possession match engine. Code lives in `src/core/match/`;
calibration constants are all in `src/core/match/tuning.ts`.

**Status:** first prototype, calibrated against modern pro-league averages. Expect large changes
once tactics, rotations and fatigue exist.

## Engine flow

```
simulateGame (game.ts)
└─ periods: 4 regulation, then 5-minute overtimes until not tied
   └─ possessions, alternating between teams until the period clock hits 0
      └─ actions (possession.ts): the first action, plus one more per offensive rebound
         1. run clock        first action ≈ 4–24 s, second chance ≈ 1–11 s, capped by the shot clock
         2. play selection   who shoots and which play type (playSelection.ts)
         3. turnover roll    ball security vs. the matched defender's pressure (turnover.ts)
         4. shot             foul roll → make roll → and-one / free throws, assist, block (shot.ts)
         5. free throws      linear in Free Throw rating (freeThrows.ts)
         6. rebound          lineup vs. lineup; offensive board → next action, same possession (rebound.ts)
```

- **Period starts** follow the pro alternating rule: the opening-tip winner starts Q1 and Q4, the
  other team Q2 and Q3; every overtime starts with a new jump ball.
- **Matchups** are slot-for-slot: lineup slot _i_ guards the opponent's slot _i_. Generated teams
  start G, G, W, W, B so this pits like against like.
- **Help defense:** each defense also has a rim protector (best `rimProtectionSkill` on the floor)
  who helps on drives and cuts (50% of the contest) and partly on post-ups (30%).
- **Five play types:** drive, cut, post-up, mid-range, three.
- **Box score** is kept per player, plus field goals by play type per team.

## The probability model: base rate + log-odds edge

Every contested event (make, turnover, shooting foul, offensive rebound) starts from a **base
rate**: what a league-average player (rating 10.5) does against league-average opposition. Skill
moves it on the **log-odds** scale:

```
p = logistic( logit(base) + edge )
edge = W_off · norm(offense skill) − W_def · norm(defense skill) + situational + size
norm(r) = (r − 10.5) / 9.5            (≈ −1 … +1)
```

Log-odds keeps every probability in (0, 1) and gives diminishing returns near the extremes.
Composite skills (`ratings.ts`) blend several 1–20 attributes for each situation, e.g. drive
offense = Driving 0.45 + Finishing 0.35 + Quickness 0.2.

Free throws are the exception: uncontested, so FT% is linear in the Free Throw rating
(rating 1 ≈ 61%, average 78%, 20 ≈ 95%).

## Offensive-bias fixes

The first draft gave the shooter twice the weight of the defender (1.0 vs. 0.5), so a league
where everyone improved scored far more, and offense was worth much more than defense. Three
changes fix that:

### 1. Equal edge weights

`OFFENSE_EDGE_WEIGHT = DEFENSE_EDGE_WEIGHT = 0.75`, applied through one function
(`matchupEdge` in `contest.ts`) for shots, turnovers (ball security vs. ball pressure) and
offensive rebounds (offensive vs. defensive rebounding). Shooting fouls use one weight for the
shooter's Aggression and the defender's Discipline. When every rating rises by the same amount,
the edges cancel.

The intended offense:defense value ratio (~1.4 : 1) now comes from **which attributes feed each
composite**, not from unequal weights: defensive composites lean more on shared physical/effort
attributes (Quickness, Strength, Vertical, Hustle) because on-ball defense is mostly staying in
front, length and effort, while scoring is mostly skill. Free throws (uncontested) add a little
extra offensive value.

### 2. Matchup-aware play selection

Each option (5 players × 5 play types) is weighted by

```
weight = BASE_PLAY_SHARE[play] · exp( 2.5 · norm(offense skill) − 1.5 · norm(contest skill) )
```

where the contest skill is exactly the one the shot will face (on-ball defender blended with the
rim protector for drives, cuts and post-ups). So a great rim protector suppresses drives and
cuts, and a weak perimeter defender gets attacked. Contest logic lives in one place
(`contest.ts`) and is shared by `shot.ts` and `playSelection.ts`.

The `exp()` form matters: adding the same amount to every rating multiplies every option's weight
by the same factor, so a uniformly better league keeps the same shot mix.

Selection is two-step: first the player, weighted by their total option weight raised to
`USAGE_EXPONENT = 0.6`, then the play type within that player. The compression stops one
player who is a few points better than his teammates from taking 50+ shots a game (real defenses
load up on stars; teammates need touches). It keeps the invariance property.

### 3. Form and clutch at both ends

Every player (not just shooters) rolls game-day form from the hidden Consistency attribute, and
Composure applies in clutch time (last 2 minutes of Q4/OT, within 5 points) for shooters, ball
handlers **and defenders**. On contested shots the on-ball defender and rim protector contribute
form/composure in the same proportion as their share of the contest (`situation.ts`). On
turnovers both the handler's and the defender's form apply.

## Calibration

Run `npm run sim:batch` (2,000 games between generated average teams; `--balance` adds the balance
tests). Targets are modern pro-league averages.

Latest results (seed 1, 2,000 games):

| Metric                      | Sim   | Target  | Result |
| --------------------------- | ----- | ------- | ------ |
| Possessions / team / 48 min | 99.6  | ≈ 99    | PASS   |
| Points / team-game          | 114.8 | 112–116 | PASS   |
| Offensive rating (pts/100)  | 115.0 | 113–117 | PASS   |
| FG%                         | .474  | .46–.48 | PASS   |
| 3PA / FGA                   | .406  | .38–.42 | PASS   |
| 3P%                         | .362  | .35–.37 | PASS   |
| FTA / FGA                   | .243  | .22–.27 | PASS   |
| FT%                         | .782  | .77–.79 | PASS   |
| Turnovers / 100 poss        | 13.2  | 12–14   | PASS   |
| ORB%                        | .240  | .23–.27 | PASS   |
| Assists / FGM               | .599  | .58–.64 | PASS   |
| Blocks / team-game          | 5.25  | 4.5–5.5 | PASS   |
| Steals / team-game          | 7.54  | 7–8     | PASS   |
| Overtime rate (games)       | .018  | .05–.07 | OFF    |

FGA mix: drive 21%, cut 9%, post-up 7%, mid-range 22%, three 41%.

### Balance tests

Paired comparison (same teams, same game seeds), each team played against generated average
teams. Attribute groups are defined in `src/core/players/attributes.ts`:

- **Offensive:** Driving, Finishing, Post Scoring, Mid-Range, Three-Point, Free Throw, Ball
  Handling, Passing, Off-Ball Movement, Offensive Rebounding, Offensive IQ, Aggression.
- **Defensive:** Perimeter Defense, Interior Defense, Stealing, Shot Blocking, Defensive
  Rebounding, Defensive IQ, Discipline.
- **Shared (neither):** Speed, Quickness, Strength, Vertical, Stamina, Durability, Composure,
  Hustle, Teamwork, Leadership, Work Ethic.

| Test                                    | Result (3 seeds × 1,500 games) | Target      |
| --------------------------------------- | ------------------------------ | ----------- |
| +3 offense, net rating gain per 100     | ≈ +16–17                       | —           |
| +3 defense, net rating gain per 100     | ≈ +11–12                       | —           |
| Offense : defense ratio                 | 1.37 – 1.47 : 1                | 1.3–1.5 : 1 |
| League +3 everywhere vs. average league | +1.0 to +1.2 pts/100           | within ±2   |

The remaining league-level shift is free throws: they're uncontested, so a league of better
shooters genuinely makes more of them.

### Known off-target: overtime rate

Simulated games go to overtime ~2% of the time vs. ~6% in real leagues. Possessions here are
independent, so the final margin of two evenly matched teams has a standard deviation of ~18
points, and a tie is about that rare. Real games end tied more often because of score effects
and end-game strategy (trailing teams fouling and hunting threes, leading teams milking the
clock), none of which is modelled yet. Fixing it belongs with end-of-game tactics, not with
tuning constants.

## Known simplifications

- **No rotations or fatigue.** Starters play the whole game; the bench only enters on a foul-out
  (closest-height bench player takes the slot).
- **Slot-for-slot matchups**; no custom defensive assignments, switching or double teams beyond
  the rim-protector help.
- **Only shooting fouls.** No reach-ins, offensive fouls, team-foul bonus or technicals, so
  shooting-foul rates are inflated to carry all free-throw trips, and personal-foul totals are
  low.
- **No transition play, shot-clock violations or end-of-period strategy** (no fouling to stop
  the clock, no holding for the last shot).
- **Turnovers are charged to the player who would have shot** on that action.
- Team rebounds, jump balls during play, and injuries aren't modelled.
- Tendencies are derived from attributes; tactics will later add coach instructions.

## Generated players and teams

`src/core/data/` holds the random generator used by the tools and tests:

- **Archetypes** guard / wing / big tilt attributes (centered biases, so archetype changes the
  shape of a player's ratings, not their level) and body type (heights ≈ 191 / 201 / 210 cm).
- **Quality** = mean visible rating; per-player level noise (SD 1) and per-attribute noise (SD 2).
- **Hidden attributes** are random around average. Current Ability is a **placeholder** derived
  from the mean visible rating until the CA budget system exists.
- **Teams:** 10 players; starters G, G, W, W, B; bench 1.5 rating points weaker.
