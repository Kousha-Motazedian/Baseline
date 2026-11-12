# Match Engine

Design reference for the possession-by-possession match engine. Code lives in `src/core/match/`;
calibration constants are all in `src/core/match/tuning.ts`.

**Status:** prototype, round 2 (full foul model, ball path, putbacks, fast breaks, late-game
score effects), calibrated against modern pro-league averages. Expect large changes
once tactics, rotations and fatigue exist.

## Engine flow

```
simulateGame (game.ts)
└─ periods: 4 regulation, then overtimes until not tied; team fouls reset per period (teamFouls.ts)
   └─ possessions, alternating between teams until the period clock hits 0
      │  each possession starts half-court, or as a fast break if the last one handed it over
      └─ actions (possession.ts): a chain until the possession ends
         0. intentional foul?  trailing defense fouls on purpose late (scoreEffects.ts)
         1. set up            ball handler (handler.ts), shooter + play type (playSelection.ts),
                              action length incl. late-game clock management
         2. handler phase     lost ball / bad pass → handler; offensive foul → handler;
                              defensive non-shooting foul → bonus free throws or a side-out
         3. shooter phase     fumbled catch / travel / strip → shooter; charge → shooter
         4. shot              foul roll → make roll → and-one / free throws, assist to the
                              passer, block (shot.ts)
         5. free throws       linear in Free Throw, Composure in clutch time (freeThrows.ts)
         6. rebound           offensive → putback or reset; defensive → maybe a fast break
```

Action kinds and their lengths (`ACTION_TIMING` in tuning.ts): half-court set 5–24.4 s, fast
break 2–7 s, reset after an offensive rebound 2–14 s, side-out after a foul 2–14 s, putback
0.5–3.5 s. All are capped by the shot clock (24, 14 after an offensive rebound, topped up to 14
after a defensive foul without free throws).

- **Period starts** follow the pro alternating rule: the opening-tip winner starts Q1 and Q4, the
  other team Q2 and Q3; every overtime starts with a new jump ball.
- **Matchups** are slot-for-slot: lineup slot _i_ guards the opponent's slot _i_. Generated teams
  start G, G, W, W, B so this pits like against like. A short-handed defense wraps around (one
  defender covers two slots).
- **Help defense:** each defense also has a rim protector (best `rimProtectionSkill` on the floor)
  who helps on drives, cuts and putbacks (50% of the contest) and partly on post-ups (30%).
- **Six shot types:** drive, cut, post-up, mid-range, three (chosen in the half court) and putback
  (only right after an offensive rebound).
- **Box score** is kept per player (now including technical fouls), plus field goals by play
  type, fast-break points, points off turnovers and offensive team rebounds per team.

## Ball path: handler, passer, shooter

Every set starts with a **ball handler**, picked with weight
`exp(3 · norm(handlerSkill))`, where handlerSkill = Ball Handling 0.45 + Passing 0.35 + Offensive
IQ 0.2. Guards start most actions (generated guards average handler skill ≈ 13 vs. ≈ 8.5 for
bigs). The shooter and play are then chosen exactly as before (matchup-aware). If the shooter
isn't the handler, that's a pass.

**Turnovers are charged to whoever last touched the ball:**

| Phase   | What happens                                  | Charged to | Steal by                                                |
| ------- | --------------------------------------------- | ---------- | ------------------------------------------------------- |
| Handler | lost ball (kept it) / bad pass (passing)      | handler    | his defender, or on a bad pass 50% the receiver's man   |
| Handler | offensive foul (push-off, moving screen)      | handler    | —                                                       |
| Shooter | fumbled catch / travel / stripped on his move | shooter    | the shooter's defender                                  |
| Shooter | charge                                        | shooter    | — (drawn by on-ball or help defender, by contest share) |

Handler-phase security is Ball Security (dribbling), averaged with Pass Security when he passes.
Base rates: handler 7.5% per set; shooter by play type (drive 5.5%, post 6%, cut 3%, mid 1.5%,
three 1%, putback 2.5%). Steal shares: 74% of handler turnovers, 50% of shooter turnovers, never
on offensive fouls.

**Assists go to the actual passer.** A make is assisted only if there was a pass (shooter ≠
handler), with chance `BASE_ASSIST[play]` (drive .70, cut .98, post .62, mid .82, three .95)
adjusted by the passer's Passing. Not every pass is an assist (a post entry the big then works
for), and a handler's own shot or a putback is never assisted. Guards end up with ≈ 62% of team
assists.

## Fouls

Every personal foul (shooting, non-shooting, offensive, intentional) counts as a **team foul**.
`commitFoul` (fouls.ts) logs the foul, then any foul-out, then any technical.

- **Shooting fouls:** shooter Aggression vs. the contest's Discipline (on-ball and help blended by
  contest share). Base rates were lowered now that other fouls create free-throw trips: drive
  .185, cut .12, post .16, mid .042, three .016, putback .11. **Attribution:** the foul goes to the
  on-ball defender or the help rim protector in proportion to their share of the contest (drives,
  cuts, putbacks 50/50; post-ups 70/30; jumpers always on-ball).
- **Non-shooting defensive fouls** (reach-in, blocking on the ball; holding, loose-ball off it):
  8.6% per set before modifiers; 65% on the ball handler, otherwise on the receiver's defender.
  Edge = 0.3·(defender Aggression − Discipline) + 0.3·(handler penetration − defender
  containment), penetration = Driving 0.6 + Quickness 0.4, containment = Quickness 0.6 +
  Perimeter Defense 0.4. In the bonus the fouled player shoots 2; otherwise a side-out.
- **Offensive fouls:** turnover + personal foul + team foul, no free throws. Handler 0.6% per set;
  shooter charges by play type (drive 3.5%, post 3%, cut 1.2%, jumpers ≈ 0.3%, putback 1%). Edge =
  0.5·(Aggression − Offensive IQ) + 0.4·(drawer's Defensive IQ − attacker's Ball Handling).
- **Technical fouls:** rolled after each personal foul (arguing the call), base 2.5%, edge =
  −1.0·norm(Temperament) − 0.5·norm(Discipline) + 0.5 in a tense game (last 5:00 of Q4/OT within 6) + 0.4 when one foul from disqualification. One free throw by the opponent's best FT shooter
  on the floor, then play continues. Two technicals eject the player (handled like a foul-out).
  Technicals count toward the personal-foul limit only where `technicalsCountTowardFoulLimit`
  (FIBA). They are not team fouls (simplification).
- **Intentional fouls:** see score effects.

### Team fouls and the bonus (`LeagueRules`)

| Rule field                       | Pro                   | FIBA                   |
| -------------------------------- | --------------------- | ---------------------- |
| `teamFoulsBeforePenalty`         | 4 (5th foul shoots)   | 4 (5th foul shoots)    |
| `overtimeTeamFoulsBeforePenalty` | 3 (4th foul shoots)   | — (carries over)       |
| `overtimeTeamFoulsCarryOver`     | false                 | true (OT continues Q4) |
| `lateFoulWindowSeconds`          | 120 (2nd foul shoots) | null                   |
| `penaltyFreeThrows`              | 2                     | 2                      |
| `technicalsCountTowardFoulLimit` | false                 | true                   |
| `noBenchDisqualification`        | `staysOn`             | `playShorthanded`      |

Real rules note: in both leagues the 5th team foul of a quarter is itself penalized (4 are
"free"), and in pro overtimes the 4th is.

### Disqualification (lineup.ts)

A fouled-out or ejected player is replaced by the closest-height eligible bench player. With
nobody left:

- **Pro (`staysOn`):** he stays on; every further personal foul he commits is charged as a team
  technical (one free throw for the opponent) instead of another personal foul, so the box score
  never exceeds the limit.
- **FIBA (`playShorthanded`):** the team plays on with fewer players. Matchups wrap, the extra
  offensive player gives the offense +0.25 log-odds per man on shots and +0.3 per man on
  rebounds. A team is never reduced below one player (the last one stays on, pro-style).

## Putbacks

After an offensive rebound the rebounder goes straight back up with chance
`adjust(0.6, 1·norm(putbackSkill) + 0.6·heightEdge)`, where putbackSkill blends Finishing 0.45,
Vertical 0.3 and Offensive Rebounding 0.25. So bigs mostly put it back and guards on long rebounds reset.
A putback is a quick (0.5–3.5 s) inside shot with no pass (never assisted), only a shooter-phase
turnover risk (2.5%), heavy rim-protector help, base make .58. Otherwise the offense kicks it out
and runs a quick reset set.

## Fast breaks (fastBreak.ts)

A change of possession can start a fast break:

| Start                           | Base chance |
| ------------------------------- | ----------- |
| Steal                           | 0.65        |
| Blocked shot recovered by the D | 0.30        |
| Ordinary defensive rebound      | 0.17        |
| Missed free throw rebound       | 0           |

Blocked shots go out of bounds (offense keeps it, an offensive **team rebound**) 25% of the
time; otherwise the offense recovers only 20% (vs. 25% on a normal miss).

The chance moves by `1.5 · (norm(runners' avg Speed) − norm(retreating avg of Speed 0.6 +
Hustle 0.4))`. A team protecting a late lead doesn't run. On the break, the player who won the
ball pushes it (he's the handler); play mix is drive 70% / three 25% / pull-up 5%. A numbers
advantage (2-on-1, 3-on-2) happens with base 35%, moved by the same speed edge. Every transition
shot gets +0.35 log-odds (+0.5 more when outnumbering), the help defender contributes only 40%
of his normal share (none when outnumbered), and shooting fouls are +0.3 log-odds likelier (more
and-ones). **Fast-break points** = every point the transition action produced (free throws
included). **Points off turnovers** = every point on a possession that started with a turnover.

## Late-game score effects (scoreEffects.ts)

Only in the final regulation period and overtime. Each team keeps its own pace otherwise; there
is no shared game pace (who dictates tempo is deferred to tactics).

- **Leading team runs clock** in the last 2:30: a set moves toward "shot clock minus 3 s" by
  `0.8 · min(1, lead / 6)` of the gap.
- **Tied team holds for the last shot** when the game clock ≤ shot clock (shoots with ~2 s left).
- **Trailing team hurries** when down 3+ in the last 1:30 (sets take 55% of normal time).
- **Intentional fouls:** the trailing team fouls when down 4–10 in the last 1:00, quickly (1–4 s),
  on the offense's worst free-throw shooter. They count toward team fouls; free throws only once
  in the bonus (pro: the 2nd foul in the last 2:00 at the latest).
- **Three hunting:** down 3+ in the last 2:00, the weight of threes is multiplied by
  `1 + 3 · (1 − clock / 120)` (up to ×4 at the buzzer).
- **Buzzer shots:** when the period clock runs out before an action would normally end, the shot
  is rushed: −1.5 log-odds × the share of the action that was cut off. Without this, holding for
  the last shot was pointless (a 1-second possession still got a full-quality shot).

## Play-by-play convention

Entries are in **chronological order** (a fouled make: the shot, then the foul, then the free
throws; a steal: the turnover, then the steal; an offensive foul: the turnover, then the foul).
`teamId` is the team that **performed** the action: blocks, steals and defensive fouls belong
to the defense; shots, turnovers and free throws to the shooting team; rebounds to the
rebounding team. "End of period" lines carry the team that started the period.

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

Each option (5 players × 5 half-court play types) is weighted by

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

### 3. Form, clutch and crowd at both ends

Every player (not just shooters) rolls game-day form from the hidden Consistency attribute, and
Composure applies in clutch time (last 2 minutes of Q4/OT, within 5 points) for shooters, ball
handlers **and defenders**, and on the road for every player. On contested shots the on-ball defender and rim protector contribute
form/composure in the same proportion as their share of the contest (`situation.ts`). On
turnovers both the handler's and the defender's form apply.

**Consistency (form):** normal-shaped, `N(0, sd)` clamped at ±2.5 sd (mean stays 0), with
`sd = 0.03 + 0.27 · ((20 − Consistency) / 19)²`: Consistency 1 → 0.30, average 10.5 → ≈ 0.10,
20 → 0.03. The convex curve is deliberate: a Consistency-1 player swings ~10x more than a
Consistency-20 one (a 36% shooter has 29% or 43% days at ±1 SD), while the many players near
average stay close to the old uniform roll's spread. Form is independent per player, so a wide
spread for the average player adds team-level noise and inflates the final-margin spread (a
linear curve measured +1.3 points of margin SD).

**Composure** also applies to (a) free throws in clutch time: ±5 percentage points at the ends of
the scale, symmetric around average; and (b) road games: a hostile-crowd penalty of
`0.008 · (1 − 0.8 · norm(Composure))` log-odds for road players at both ends (shots, contests,
ball security). Composure 20 feels a fifth of it, Composure 1 almost double. `HOME_SHOOTING_EDGE`
was lowered from 0.03 to 0.01 so the net home edge stays ≈ +1.3 points.

## Calibration

Run `npm run sim:batch` (2,000 games between generated average teams; `--balance` adds the balance
tests). Targets are modern pro-league averages.

Latest results (2,000 games per seed):

| Metric                      | Seed 1 | Seed 2 | Seed 3 | Target   | Result |
| --------------------------- | ------ | ------ | ------ | -------- | ------ |
| Possessions / team / 48 min | 99.6   | 99.6   | 99.7   | 97–101   | PASS   |
| Points / team-game          | 115.4  | 115.7  | 115.4  | 112–116  | PASS   |
| Offensive rating (pts/100)  | 115.5  | 115.8  | 115.5  | 113–117  | PASS   |
| FG%                         | .472   | .475   | .473   | .46–.48  | PASS   |
| 3PA / FGA                   | .396   | .395   | .396   | .38–.42  | PASS   |
| 3P%                         | .356   | .358   | .357   | .35–.37  | PASS   |
| FTA / FGA                   | .246   | .245   | .246   | .22–.27  | PASS   |
| FT%                         | .779   | .780   | .780   | .77–.79  | PASS   |
| Turnovers / 100 poss        | 12.7   | 12.8   | 12.7   | 12–14    | PASS   |
| ORB%                        | .238   | .237   | .236   | .23–.27  | PASS   |
| Assists / FGM               | .607   | .606   | .607   | .58–.64  | PASS   |
| Blocks / team-game          | 5.07   | 5.02   | 5.05   | 4.5–5.5  | PASS   |
| Steals / team-game          | 7.44   | 7.51   | 7.50   | 7–8      | PASS   |
| Personal fouls / team-game  | 20.1   | 20.0   | 20.0   | 19–21    | PASS   |
| Technicals / team-game      | 0.56   | 0.53   | 0.56   | 0.4–0.8  | PASS   |
| Fast-break points / game    | 13.5   | 13.6   | 13.5   | 12–16    | PASS   |
| Points off turnovers / game | 15.3   | 15.5   | 15.3   | (report) | —      |
| Overtime rate (league)      | .025   | .023   | .025   | .05–.07  | OFF    |

FGA mix: drive 22%, cut 7.5%, post-up 5%, mid-range 18%, three 40%, putback 7%. Foul mix per
team-game (seed 1, 300 games): shooting ≈ 9, non-shooting ≈ 8.5, offensive ≈ 2, intentional ≈ 0.5.

**Identical teams** (each generated team vs. an exact copy, home alternating, 2,000 games):

| Metric             | Before round 2 | Seed 1 | Seed 2 | Seed 3 | Target  |
| ------------------ | -------------- | ------ | ------ | ------ | ------- |
| Margin SD (points) | 17.5–18.5      | 19.7   | 20.2   | 19.8   | 13–15   |
| Overtime rate      | .025–.027      | .025   | .019   | .019   | .05–.07 |
| Home win rate      | .51–.53        | .534   | .521   | .544   | ≈ .53   |
| Home margin        | +0.5 to +1.2   | +1.54  | +0.49  | +1.74  | ≈ +1.3  |

### Balance tests

Paired comparison (same teams, same game seeds), each team played against generated average
teams. Attribute groups are defined in `src/core/players/attributes.ts`:

- **Offensive:** Driving, Finishing, Post Scoring, Mid-Range, Three-Point, Free Throw, Ball
  Handling, Passing, Off-Ball Movement, Offensive Rebounding, Offensive IQ, Aggression.
- **Defensive:** Perimeter Defense, Interior Defense, Stealing, Shot Blocking, Defensive
  Rebounding, Defensive IQ, Discipline.
- **Shared (neither):** Speed, Quickness, Strength, Vertical, Stamina, Durability, Composure,
  Hustle, Teamwork, Leadership, Work Ethic.

| Test (2,000 paired games per seed)      | Seed 1 | Seed 2 | Seed 3 | Target                 |
| --------------------------------------- | ------ | ------ | ------ | ---------------------- |
| +3 offense, net rating gain per 100     | +17.00 | +17.29 | +16.62 | —                      |
| +3 defense, net rating gain per 100     | +11.98 | +14.03 | +11.25 | —                      |
| Offense : defense ratio                 | 1.42   | 1.23   | 1.48   | 1.3–1.5 (avg **1.38**) |
| League +3 everywhere vs. average league | +1.16  | +1.39  | +1.57  | within ±2              |

Seed 2's league is consistently defense-heavy (its ratio was the lowest in every variant tried);
the target is the average across seeds. The new mechanics gave defensive attributes more
work (charges, passing-lane steals, Discipline against bonus fouls, defensive rebounds and steals
starting fast breaks). To keep the ratio, the attacker's offensive-foul habits use only
offensive attributes (Aggression vs. Offensive IQ; previously Discipline let a "+3 defense" team
foul less on offense), non-shooting-foul temperament has its own smaller weight, and a few
defensive composites lean a little more on shared attributes (containment is mostly Quickness;
jump-shot contests Perimeter Defense 0.55 / Quickness 0.25; defensive rebounding 0.55 / Strength
0.25 / Vertical 0.2).

The remaining league-level shift is free throws: they're uncontested, so a league of better
shooters genuinely makes more of them.

### Known off-target: margin spread and overtime rate

Two evenly matched teams finish with a margin SD of ~20 points (real ≈ 13–15) and go to overtime
~2–2.5% of the time (real ≈ 6%). The late-game score effects are implemented and work as
designed, but they barely move either number (with all of them switched off, seed 1 identical
teams measured SD 19.3 / OT 2.0%; on, 19.3 / 2.2% before the buzzer rule, 2.5% after it). That
is expected: the last 2–3 minutes carry only ~5% of a game's scoring variance, so no late-game
rule can take the SD from ~19 to 13–15. Ties at the end of regulation are about as rare as the
margin spread implies.

The SD rose from ~18 to ~19.8 this round for two reasons: the wider normal-shaped form spread
(≈ +1.3 points; reduced from +1.8 by the convex Consistency curve) and more free-throw and
fast-break variance.

Real basketball's lower spread comes from whole-game score effects: garbage-time rotations
(starters rest in blowouts), the leading team easing off, the trailing team pressing. These need
rotations, fatigue and tactics. Calibration constants weren't bent to force the target.

## Known simplifications

- **No rotations or fatigue.** Starters play the whole game; the bench only enters on a foul-out
  or ejection (closest-height bench player takes the slot). No garbage time, so blowouts keep
  their starters (one reason the margin spread is too wide).
- **Slot-for-slot matchups**; no custom defensive assignments, switching or double teams beyond
  the rim-protector help.
- **Whole-game score effects** (easing off with a big lead, pressing when far behind) aren't
  modelled; only the last few minutes react to the score.
- **The clock runs for the whole action before its outcome is resolved**, including turnovers
  and non-shooting fouls that would really end it earlier; the side-out that follows is short to
  compensate. No shot-clock violations, no 2-for-1s, no fouling when up 3, no timeouts.
- **Loose-ball fouls on rebounds** are folded into the non-shooting foul rate (labelled only).
- **Technicals** are only rolled after a personal foul, never count as team fouls, and there are
  no bench/coach technicals or flagrant fouls.
- **Kick-out resets** pick a fresh ball handler rather than the rebounder.
- **Composure on the road** doesn't affect free throws (only clutch time does).
- **Fast-break points** count only the transition action itself (not a putback after it); if the
  trailing defense fouls intentionally on a break, those free throws count as fast-break points.
- Jump balls during play and injuries aren't modelled. Defensive team rebounds aren't tracked
  (only the offensive team rebound from a block out of bounds).
- Tendencies are derived from attributes; tactics will later add coach instructions.

## Generated players and teams

`src/core/data/` holds the random generator used by the tools and tests:

- **Archetypes** guard / wing / big tilt attributes (centered biases, so archetype changes the
  shape of a player's ratings, not their level) and body type (heights ≈ 191 / 201 / 210 cm).
- **Quality** = mean visible rating; per-player level noise (SD 1) and per-attribute noise (SD 2).
- **Hidden attributes** are random around average. Current Ability is a **placeholder** derived
  from the mean visible rating until the CA budget system exists.
- **Teams:** 10 players; starters G, G, W, W, B; bench 1.5 rating points weaker.
