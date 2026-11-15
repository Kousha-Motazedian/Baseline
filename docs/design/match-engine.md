# Match Engine

Design reference for the possession-by-possession match engine. Code lives in `src/core/match/`;
calibration constants are all in `src/core/match/tuning.ts`.

**Status:** prototype, round 3 (full foul model, ball path, putbacks, fast breaks, late-game
score effects, tie-seeking end-game play, separate offensive/defensive form, and two
**stopgaps** — foul-trouble benching and blowout easing — that stand in for rotations),
calibrated against modern pro-league averages. Expect large changes once tactics, rotations and
fatigue exist.

## Engine flow

```
simulateGame (game.ts)
└─ periods: 4 regulation, then overtimes until not tied; team fouls reset per period (teamFouls.ts)
   └─ possessions, alternating between teams until the period clock hits 0
      │  each starts with the STOPGAP foul-trouble bench check (foulTrouble.ts), then half-court,
      │  or as a fast break if the last possession handed it over
      └─ actions (possession.ts): a chain until the possession ends
         0. intentional foul?  the defense fouls on purpose late (scoreEffects.ts), else
            run out clock?     a leader with game clock ≤ shot clock just holds the ball
         1. set up            ball handler (handler.ts), shooter + play type (playSelection.ts),
                              action length incl. late-game and end-of-period clock management
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

- **Period starts** follow `LeagueRules.periodStartRule`. Pro (`quarterRotation`): the
  opening-tip winner starts Q1 and Q4, the other team Q2 and Q3; every overtime starts with a new
  jump ball. FIBA (`alternatingArrow`, Art. 12.5): every period after the first, overtimes
  included, starts with an alternating-possession throw-in; the arrow first points to the tip
  loser, so the tip loser starts Q2, Q4, OT2…, the winner Q3, OT1… (no held balls are modelled,
  so nothing else flips the arrow).
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

Every defensive personal foul (shooting, non-shooting, intentional) counts as a **team foul**;
offensive fouls count only where `offensiveFoulsCountAsTeamFouls` is set (FIBA). `commitFoul`
(fouls.ts) logs the foul, then any foul-out, then any technical, then any STOPGAP foul-trouble
substitution (a foul is a dead ball).

- **Shooting fouls:** shooter Aggression vs. the contest's Discipline (on-ball and help blended by
  contest share). Base rates were lowered now that other fouls create free-throw trips: drive
  .185, cut .12, post .16, mid .042, three .016, putback .11. **Attribution:** the foul goes to the
  on-ball defender or the help rim protector in proportion to their share of the contest (drives,
  cuts, putbacks 50/50; post-ups 70/30; jumpers always on-ball).
- **Non-shooting defensive fouls** (reach-in, blocking on the ball; holding, loose-ball off it):
  9.1% per set before modifiers; 65% on the ball handler, otherwise on the receiver's defender.
  Edge = 0.3·(defender Aggression − Discipline) + 0.3·(handler penetration − defender
  containment), penetration = Driving 0.6 + Quickness 0.4, containment = Quickness 0.6 +
  Perimeter Defense 0.4. In the bonus the fouled player shoots 2; otherwise a side-out.
- **Offensive fouls:** turnover + personal foul (+ team foul in FIBA only), no free throws.
  Handler 0.6% per set; shooter charges by play type (drive 3.5%, post 3%, cut 1.2%, jumpers
  ≈ 0.3%, putback 1%). Edge = 0.5·(Aggression − Offensive IQ) + 0.4·(drawer's Defensive IQ −
  attacker's Ball Handling).
- **Technical fouls:** rolled after each personal foul (arguing the call), base 2.5%, edge =
  −1.0·norm(Temperament) − 0.5·norm(Discipline) + 0.5 in a tense game (last 5:00 of Q4/OT
  within 6) + 0.4 when one foul from disqualification. One free throw by the opponent's best FT
  shooter on the floor, then play continues. Two technicals eject the player (he always leaves
  the floor; see Disqualification). Technicals count toward the personal-foul limit only where
  `technicalsCountTowardFoulLimit` (FIBA). They are not team fouls (simplification).
- **Intentional fouls:** see score effects. They never roll a technical (nobody argues a foul
  his own team chose to commit).
- **Foul-trouble caution:** a player one foul from disqualification commits every kind of foul
  (shooting, non-shooting, offensive) at `FOUL_TROUBLE_CAUTION` = 2 log-odds lower (≈ 1/6 the
  rate): he stops reaching, contests softly and doesn't charge in. On shots the caution is
  blended by contest share like Discipline. Part of the foul-trouble stopgap (see below): late in
  the game nobody can be benched, so without it starters on 5 fouls fouled out ~1 time in 3.

### Team fouls and the bonus (`LeagueRules`)

| Rule field                       | Pro                   | FIBA                   |
| -------------------------------- | --------------------- | ---------------------- |
| `teamFoulsBeforePenalty`         | 4 (5th foul shoots)   | 4 (5th foul shoots)    |
| `overtimeTeamFoulsBeforePenalty` | 3 (4th foul shoots)   | — (carries over)       |
| `overtimeTeamFoulsCarryOver`     | false                 | true (OT continues Q4) |
| `lateFoulWindowSeconds`          | 120 (2nd foul shoots) | null                   |
| `penaltyFreeThrows`              | 2                     | 2                      |
| `technicalsCountTowardFoulLimit` | false                 | true                   |
| `offensiveFoulsCountAsTeamFouls` | false                 | true                   |
| `noBenchDisqualification`        | `staysOn`             | `playShorthanded`      |
| `periodStartRule`                | `quarterRotation`     | `alternatingArrow`     |

Real rules note: in both leagues the 5th team foul of a quarter is itself penalized (4 are
"free"), and in pro overtimes the 4th is. **Offensive fouls** are our reading of the rulebooks
and should be checked before a licensed league relies on them: NBA offensive fouls (charges
included) are personal fouls but not team fouls toward the penalty; under FIBA every player foul,
offensive ones included, is a team foul.

### Disqualification (lineup.ts)

Each lineup slot has a **regular** (`TeamState.regulars`: the starter, or whoever replaced him
after a disqualification); the player actually in the slot is either the regular or a sub
filling in while he sits with fouls. A fouled-out or ejected player is replaced by the best
eligible bench player: first the slot's own regular if he's free to play, then a reserve not in
foul trouble, then the slot's regular even in foul trouble, then a reserve in foul trouble, and
last another slot's resting regular (his slot is then re-assigned); closest height breaks ties.
A regular's replacement becomes the slot's new regular. With nobody left:

- **Ejected (two technicals):** he always leaves the floor and the team plays short-handed,
  under every rule set.
- **Fouled out, pro (`staysOn`):** he stays on; every further personal foul he commits is charged
  as a team technical (one free throw for the opponent) instead of another personal foul, so the
  box score never exceeds the limit.
- **Fouled out, FIBA (`playShorthanded`):** the team plays on with fewer players.

Short-handed: matchups wrap, the extra offensive player gives the offense +0.25 log-odds per man
on shots and +0.3 per man on rebounds. A team is never reduced below one player (the last one
stays on, pro-style).

### STOPGAP: foul-trouble benching (foulTrouble.ts)

Until rotations exist, starters play every minute they can, so they used to foul out 2.5 times
a game (real ≈ 0.1–0.3). As a stopgap, a player **sits** once his fouls reach
`personalFoulLimit − margin`, margin by period `FOUL_TROUBLE_MARGINS` = 4, 3, 2, 1 (never fewer
than 2 fouls): pro 2 in Q1, 3 in Q2, 4 in Q3, 5 in Q4 — until the last 5:00 of regulation
(`FOUL_TROUBLE_RELEASE_SECONDS`); nobody sits in the last 5:00 or in overtime. FIBA (5-foul
limit): 2, 2, 3, 4.

- The check runs at every dead ball the engine knows: each possession start (both teams), right
  after each foul, and right after a technical that counts as a personal foul (FIBA).
- A sitting player is replaced by the closest-height **reserve** who is free to play (not
  another slot's regular, not in foul trouble himself). No such reserve → he plays on.
- The regular **returns** at the first check where he is free again: the next period's
  threshold, or the late-game release. A sub who gets into foul trouble is swapped for another
  reserve.
- Together with the foul-trouble caution above it brings foul-outs to ≈ 0.25 per game.

**Replace it** with the coach's rotation and foul-trouble settings (tactics/) once rotations
exist, then delete foulTrouble.ts.

## Putbacks

After an offensive rebound the rebounder goes straight back up with chance
`adjust(0.6, 1·norm(putbackSkill) + 0.6·heightEdge)`, where putbackSkill blends Finishing 0.45,
Vertical 0.3 and Offensive Rebounding 0.25. So bigs mostly put it back and guards on long
rebounds reset.
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

Mostly in the final regulation period and overtime ("late"). Each team keeps its own pace
otherwise; there is no shared game pace (who dictates tempo is deferred to tactics). Each
action first checks, in order: does the **defense** foul on purpose? does the **offense** run out
the clock? Only then is a set run.

**Clock management**

- **Leading team runs clock** in the last 2:30: a set moves toward "shot clock minus 3 s" by
  `0.8 · min(1, lead / 6)` of the gap. Its shot pays a late-clock penalty of
  `MILK_SHOT_PENALTY · share` (0.5 log-odds at full milking): real late-shot-clock shots convert
  ~10 points of eFG% worse, so protecting a lead is a trade-off rather than free.
- **Run out the clock:** a team leading late with game clock ≤ its shot clock just holds the
  ball: no shot, no rushed heave; the period ends with the possession.
- **Last shot of a period** (game clock ≤ shot clock, every period): a team holding for the last
  shot shoots with 2 s left (`LAST_SHOT_BUFFER_SECONDS`). Everyone holds in Q1–Q3; late, only a
  tied team (a miss means overtime). A team down 1–3 late shoots with 5 s left
  (`TRAILING_SHOT_BUFFER_SECONDS`): a tying basket leaves the opponent too little for a set, but
  there's time for a rebound or a foul. Anyone else plays normally but shoots by the 2 s mark.
  If there isn't even time for a quick set (the action kind's minimum), the action plays out and
  the shot is a rushed heave.
- **Trailing team hurries** when down 3+ in the last 1:30 (sets take 55% of normal time).
- **Buzzer shots:** when the period clock runs out before an action would normally end, the shot
  is rushed: −1.5 log-odds × the share of the action that was cut off.

**Intentional fouls** (`intentionalFoulPlan`), never with 1 s or less left
(`INTENTIONAL_FOUL_CUTOFF_SECONDS`: no time to foul). Each takes 1–4 s
(`INTENTIONAL_FOUL_MIN_DURATION` plus a spread), always within the clock left, so every foul
uses clock and the game always ends. They count toward team fouls; free throws only once in
the bonus (pro: the 2nd foul in the last 2:00 at the latest), otherwise a side-out.

- **Stop the clock** (trailing team), two cases:
  - _Extra possessions:_ down 4 or more in the last 30 s, up to a cap that shrinks with the
    clock: `3 + clock / 6` (0:30 → 8, 0:12 → 5, 0:06 → 4). Each foul-and-answer exchange takes
    ~6 s and gains the trailing team about a point at best, so a bigger deficit is over. (Round 3
    first used a fixed 4–10 in the last minute; the leader's free throws pushed the gap just past
    the cap and then the fouling stopped, so ~20% of identical-team finals landed on 11–12.)
  - _Chase:_ down 1–3 (`CHASE_FOUL_MAX_DEFICIT`) once the leader could run out the clock (game
    clock ≤ its shot clock): without a foul it never gets the ball back. _Judgment call:_ the
    brief said down 1–2; we include down 3, because a team down 3 that doesn't foul just
    watches the leader run out the clock.
- **Who is fouled:** pro, inside the away-from-the-play window
  (`LeagueRules.awayFromPlayFoulWindowSeconds` = 120, the last 2:00 of Q4/OT), the ball handler
  or inbound receiver: an off-ball foul there costs one free throw (any shooter) plus
  possession, so teams can't hunt the worst free-throw shooter. Elsewhere (FIBA, or outside the
  window) the offense's worst free-throw shooter on the floor.
- **Deny the tying three** (leading team): up exactly 3 in the final 6 s
  (`FOUL_UP_THREE_SECONDS`, 0 turns it off), foul the ball handler before he can shoot; two free
  throws can only cut it to 1. A coaching choice: it should become a tactics setting.
- **Who fouls:** the defender with the fewest fouls among those it won't foul out, preferring
  the target's own man on a tie, so the job rotates (anyone eligible if nobody is that safe; a
  disqualified player who had to stay on is never used, his foul would be a technical).
- The fouled shooter never misses a free throw on purpose (simplification).
- Not modelled: FIBA's **unsportsmanlike foul** (an obvious foul with no play on the ball: 2 free
  throws plus possession), which in real FIBA games limits deliberate fouling; and the NBA
  **"take foul"** rule (a deliberate foul to stop a transition chance: 1 free throw plus
  possession). Both are listed under known simplifications.

**Shot selection and quality**

- **Three hunting:** down 3+ in the last 2:00, the weight of threes is multiplied by
  `1 + 3 · (1 − clock / 120)` (up to ×4 at the buzzer).
- **Tying three:** down exactly 3 in the final 30 s, threes get ×10 (`TYING_THREE_FACTOR`),
  so ≈ 85–90% of the shots are threes. Down exactly 2 in the same window, threes get ×0.5
  (`TYING_TWO_THREE_FACTOR`): most coaches play for the tying two and overtime rather than the
  winning three. In the final 30 s these tying factors replace the general three hunting
  (they don't take the larger of the two, or the down-2 preference could never apply).
- **Keyed defense:** in the last 60 s of a game within 5 (final period/OT), every shot gets
  −0.3 log-odds (`KEYED_DEFENSE_EDGE`): the defense knows what's coming and sells out to stop it
  (real last-possession shots go in ~30–35%). It helps ties survive to overtime.

## STOPGAP: blowout easing (blowout.ts)

Real games don't keep spreading out once they're decided: starters rest, the leader eases off,
garbage-time lineups play. Without rotations the engine had none of that, and evenly matched
teams finished with a margin SD of ~18–20 points (target 12–14, see Calibration). As a stopgap, a team with a
big, safe **second-half** lead eases off: every one of its players gets `easeOffEdge` (zero or
negative log-odds) added to his personal edge, at **both ends** (shots, contests, ball security
and ball pressure). It changes effort only, never pace.

```
safety = lead / (2.0 · √(regulation minutes left, at least 1))   (the lead in SDs of the swing to come)
ease   = −0.17 · smooth(lead: 4 → 15) · smooth(safety: 0.5 → 2.5)   (BLOWOUT_MAX_EASE = 0.17)
```

`smooth` is a smoothstep (0 below the start, 1 above the end, an S-curve between), so there is
no cliff at any score or time. The size ramp starts low (4 points) on purpose: with the safety
ramp it only bites late (a 6-point lead is "safe" with about a minute left), and that late
easing pulls moderate leads back toward close games, which added a few tenths of a point of
overtime rate over starting at 8. Both ramps must be on: a 6-point lead with a minute left is
"safe" but nobody eases off much in a 6-point game, and a 25-point lead early in Q3 is still
played hard for a while. The safety ramp starts at 0.5 (round 3 first used 1): the easing then
reaches more mid-sized second-half leads, which lowered the margin spread and raised overtime a
little. Never in the first half or overtime (starting it in Q2 was tried: lower SD, no clear
overtime gain, and the brief asked for second-half leads). Because it applies at both ends,
it moves the margin without moving league scoring.

**Replace it** once rotations and tactics exist: then the bench should actually play garbage
time (its lower ratings do the work) and blowout.ts should be deleted.

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

Every player (not just shooters) rolls game-day form from the hidden Consistency attribute,
**separately for offense and defense** (two independent rolls with the same spread; a hot
shooting night says nothing about his defense), and
Composure applies in clutch time (last 2 minutes of Q4/OT, within 5 points) for shooters, ball
handlers **and defenders**, and on the road for every player. On contested shots the on-ball
defender and rim protector contribute
form/composure in the same proportion as their share of the contest (`situation.ts`). On
turnovers both the handler's (offensive) and the defender's (defensive) form apply.

**Consistency (form):** normal-shaped, `N(0, sd)` clamped at ±2.5 sd (mean stays 0), with
`sd = 0.03 + 0.27 · ((20 − Consistency) / 19)²`: Consistency 1 → 0.30, average 10.5 → ≈ 0.10,
20 → 0.03. The convex curve is deliberate: a Consistency-1 player swings ~10x more than a
Consistency-20 one (a 36% shooter has 29% or 43% days at ±1 SD), while the many players near
average stay close to the old uniform roll's spread. Form is independent per player, so a wide
spread for the average player adds team-level noise and inflates the final-margin spread (a
linear curve measured +1.3 points of margin SD). Splitting the single roll (which moved a
player's offense and defense together, doubling his net swing) into two independent ones cut
the identical-teams margin SD by ≈ 1.3 points with no calibration cost.

**Composure** also applies to (a) free throws in clutch time: ±5 percentage points at the ends of
the scale, symmetric around average; and (b) road games: a hostile-crowd penalty of
`0.008 · (1 − 0.8 · norm(Composure))` log-odds for road players at both ends (shots, contests,
ball security). Composure 20 feels a fifth of it, Composure 1 almost double. `HOME_SHOOTING_EDGE`
was lowered from 0.03 to 0.01 so the net home edge stays ≈ +1.3 points.

## Team systems and coaching (coaching.ts, src/core/tactics/)

A `MatchTeam` may carry `coaching` (`TeamCoaching`: the system run plus offensive and defensive
execution edges, built by `coachingInputs` in `src/core/tactics/coaching.ts`). At tip-off
`teamTactics` (coaching.ts) turns it into the team's `TeamTactics`: the system's lever values
(`systemEffects`, src/core/tactics/effects.ts), the scaled half-court play shares, the execution
edges and every roster player's fit. Design and effect sizes: [coaches.md](coaches.md), sections 2–4.

**Identity guarantee.** Without `coaching`, or with `BALANCED_SYSTEM` and zero execution edges,
every hook adds exactly 0 or multiplies by exactly 1 and none draws a random number, so the engine
produces byte-identical results to the pre-systems engine. `tests/core/match/systems.test.ts` hashes
40 fixed-seed games (pro and FIBA) against a hash recorded before systems existed.

Where each lever enters the engine:

| Setting              | Hook                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Pace                 | `pacedSeconds` (possession.ts): half-court/reset/side-out set length ×0.85 / ×1.15; small shot-quality edge                                |
| Shot profile, action | `halfCourtShares` (play-type share multipliers) + the volume rule's shot-quality edge (`systemShotEdge`)                                   |
| Ball movement        | usage exponent (`PlayOptions.usageExponent`), assist edge (`assistChance`), handler turnovers, shot quality                                |
| Transition           | `fastBreakChance`: the runners' own edge plus the retreating team's "allowed" edge                                                         |
| Offensive rebounding | `offensiveReboundChance` (not on free throws) + extra fast-break edge after the defense's board                                            |
| Defensive pressure   | turnovers (`systemTurnoverEdge`), steal share, non-shooting and shooting fouls, drive/cut contest                                          |
| Help priority        | contest edge by play type in `systemShotEdge` (rim vs. jump shots)                                                                         |
| Execution and fit    | `coachingEdge`, added last in `personalEdge` (situation.ts): the player's shots/ball security on offense, his contests/pressure on defense |

Fast-break shots get no system shot edge (neither system is set in transition). The rotation
settings have no hook yet. Every team still plays man-to-man (no zone or switching).

## Calibration

Run `npm run sim:batch` (2,000 games between generated average teams; `--balance` adds the balance
tests). Targets are modern pro-league averages.

Latest results (round 3 after the fix pass, 2,000 games per seed):

| Metric                      | Seed 1 | Seed 2 | Seed 3 | Seed 7 | Seed 11 | Target   | Result |
| --------------------------- | ------ | ------ | ------ | ------ | ------- | -------- | ------ |
| Possessions / team / 48 min | 99.3   | 99.4   | 99.4   | 99.5   | 99.4    | 97–101   | PASS   |
| Points / team-game          | 114.2  | 114.6  | 114.3  | 114.3  | 114.4   | 112–116  | PASS   |
| Offensive rating (pts/100)  | 114.5  | 114.9  | 114.6  | 114.3  | 114.5   | 113–117  | PASS   |
| FG%                         | .473   | .473   | .473   | .472   | .472    | .46–.48  | PASS   |
| 3PA / FGA                   | .393   | .394   | .392   | .393   | .391    | .38–.42  | PASS   |
| 3P%                         | .355   | .357   | .355   | .355   | .355    | .35–.37  | PASS   |
| FTA / FGA                   | .227   | .229   | .228   | .226   | .229    | .22–.27  | PASS   |
| FT%                         | .783   | .784   | .782   | .782   | .780    | .77–.79  | PASS   |
| Turnovers / 100 poss        | 12.8   | 12.7   | 12.8   | 12.8   | 12.8    | 12–14    | PASS   |
| ORB%                        | .238   | .239   | .236   | .237   | .238    | .23–.27  | PASS   |
| Assists / FGM               | .604   | .603   | .605   | .605   | .604    | .58–.64  | PASS   |
| Blocks / team-game          | 5.09   | 5.03   | 5.01   | 5.07   | 5.01    | 4.5–5.5  | PASS   |
| Steals / team-game          | 7.53   | 7.45   | 7.53   | 7.63   | 7.51    | 7–8      | PASS   |
| Personal fouls / team-game  | 19.7   | 19.8   | 19.8   | 19.7   | 19.9    | 19–21    | PASS   |
| Technicals / team-game      | 0.57   | 0.58   | 0.55   | 0.57   | 0.55    | 0.4–0.8  | PASS   |
| Foul-outs / game            | 0.23   | 0.22   | 0.22   | 0.21   | 0.23    | 0.1–0.3  | PASS   |
| Team-games under 70 pts     | .000   | .000   | .000   | .000   | .000    | ≤ .01    | PASS   |
| Fast-break pts / team-game  | 13.5   | 13.5   | 13.6   | 13.7   | 13.5    | 12–16    | PASS   |
| Points off TO / team-game   | 15.3   | 15.1   | 15.1   | 15.4   | 15.2    | (report) | —      |
| Overtime rate (league)      | .034   | .033   | .040   | .043   | .038    | .05–.07  | OFF    |

Round 2 for comparison: foul-outs 2.48–2.53 per game, overtime .023–.025, FTA/FGA .246 (now
≈ .228: pro offensive fouls no longer count toward the bonus, and late intentional fouling is
narrower; `BASE_NON_SHOOTING_FOUL` went from 0.086 to 0.091 to keep fouls near 20). The league
overtime rate is a little below the identical-teams one because league games pair different
teams, so they are less often close.

**"Under 70" design intent:** low team scores should come from team quality and tactics (bad
teams, tanking), never from inflating bad teams' scoring to hit a target. The ≤ 1% check
applies only to typical games between similar league-average teams; a real mismatch may
legitimately go lower.

FGA mix (seed 1): drive 22.6%, cut 7.5%, post-up 5.4%, mid-range 18.2%, three 39.3%, putback 7.0%. Foul
mix per team-game (round 2, seed 1, 300 games): shooting ≈ 9, non-shooting ≈ 8.5, offensive ≈ 2,
intentional ≈ 0.5.

**Identical teams** (each generated team vs. an exact copy, home alternating, 2,000 games). The
margin-SD target is **12–14**: identical teams have no strength gap at all, so the right
comparison is the real spread left once team strength is accounted for (≈ what's left after
betting lines, ≈ 12–13), not the raw 13–15 of all real games.

| Metric                  | Round 2 (1/2/3/7)         | Seed 1 | Seed 2 | Seed 3 | Seed 7 | Seed 11 | Target   |
| ----------------------- | ------------------------- | ------ | ------ | ------ | ------ | ------- | -------- |
| Margin SD (points)      | 19.7 / 20.2 / 19.8 / 19.8 | 13.1   | 13.4   | 13.1   | 13.5   | 13.5    | 12–14    |
| Overtime rate           | .025 / .019 / .019 / .021 | .051   | .041   | .045   | .046   | .056    | .05–.07  |
| Home win rate           | .521–.544                 | .536   | .517   | .545   | .531   | .519    | ≈ .53    |
| Home margin             | +0.49 to +1.74            | +1.10  | +0.62  | +1.10  | +0.89  | +0.52   | ≈ +1.3   |
| Finals decided by 11/12 | —                         | .069   | .084   | .080   | .093   | .081    | (report) |

Before the fix pass (fixed 4–10 foul window), ≈ 20% of identical-team finals landed on 11–12;
now ≈ 8%, about what a smooth distribution with this spread gives.

Where the margin SD went (seed 1, identical teams, measured while tuning): everything in round 3
except the blowout easing 19.7 → ≈ 18.4 (mostly the separate offensive/defensive form); adding
the easing → ≈ 14.4; the late-clock milking penalty ≈ −0.4 more; the fix pass (easing safety
ramp from 0.5) ≈ −0.8 more. The home edge shrank a little (the easing applies to whichever
team leads, home teams lead more often).

### Balance tests

Paired comparison (same teams, same game seeds), each team played against generated average
teams. Attribute groups are defined in `src/core/players/attributes.ts`:

- **Offensive:** Driving, Finishing, Post Scoring, Mid-Range, Three-Point, Free Throw, Ball
  Handling, Passing, Off-Ball Movement, Offensive Rebounding, Offensive IQ, Aggression.
- **Defensive:** Perimeter Defense, Interior Defense, Stealing, Shot Blocking, Defensive
  Rebounding, Defensive IQ, Discipline.
- **Shared (neither):** Speed, Quickness, Strength, Vertical, Stamina, Durability, Composure,
  Hustle, Teamwork, Leadership, Work Ethic.

| Test (2,000 paired games per seed)      | Seed 1 | Seed 2 | Seed 3 | Seed 7 | Seed 11 | Target                 |
| --------------------------------------- | ------ | ------ | ------ | ------ | ------- | ---------------------- |
| +3 offense, net rating gain per 100     | +12.47 | +11.91 | +12.01 | +13.17 | +12.51  | —                      |
| +3 defense, net rating gain per 100     | +9.26  | +7.97  | +9.22  | +9.31  | +9.07   | —                      |
| Offense : defense ratio                 | 1.35   | 1.50   | 1.30   | 1.41   | 1.38    | 1.3–1.5 (avg **1.39**) |
| League +3 everywhere vs. average league | +1.53  | +1.54  | +1.18  | +1.68  | +1.59   | within ±2              |

Round 2: gains +16.6 to +17.3 (offense) and +11.3 to +14.0 (defense), ratios 1.42 / 1.23 / 1.48
(seed 7: 1.46). Both gains shrank by about a quarter in round 3 because the blowout easing makes
a better team ease off once it's comfortably ahead, so it wins by less (as real better teams
do); the ratio is unchanged on average. The per-seed ratio is noisy (it divides two noisy
gains), which is why the target is the average across seeds.

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

### Known off-target: overtime rate

Round 3 brought the identical-teams margin SD into range and roughly doubled the overtime rate
(≈ 2% → identical teams .041–.056 across seeds 1/2/3/7/11, mean ≈ .048; league games
.033–.043), so overtime is at or a little below the 5–7% target depending on seed.

What moved it: the blowout easing (lower SD puts more games near a tie), the trailing team
fouling once the leader could run out the clock (≈ +0.9 points of OT%), the late-clock milking
penalty (≈ +0.35), holding for the last shot, and (fix pass) the shrinking foul cap and the
tying-two preference now actually applying. What barely moved it: keyed defense (it also makes
tying shots harder), the up-3 foul and the trailing team's 5 s shot buffer.

The number of close games is about right: measured as the real "clutch games" stat (within 5 at
**any** point in the last 5:00), ≈ 51% of identical-team games and ≈ 47% of league games
qualify (tester's measurement), close to real. (An earlier version of this section compared
"within 5 exactly at the 5:00 mark", ≈ 27%, to that stat, which isn't like for like.) The gap was **late-game conversion**: fouling drained close
games instead of extending them (the fixed 4–10 window pushed trailing teams out of range,
after which they stopped fouling). The fix pass shrinks the window with the clock. Modelling
the pro away-from-the-play rule (no more hunting the worst free-throw shooter late) is realistic
but pulls overtime down slightly. Whatever gap remains we leave rather than force with
unrealistic rules.

## Known simplifications

- **No rotations or fatigue.** Starters play the whole game; the bench only enters on a foul-out,
  an ejection or (STOPGAP) foul trouble. No garbage time: the STOPGAP blowout easing stands in
  for it.
- **Slot-for-slot matchups**; no custom defensive assignments, switching or double teams beyond
  the rim-protector help.
- **Whole-game score effects** are limited to the STOPGAP blowout easing; the trailing team
  doesn't press or change tactics before the last few minutes.
- **The clock runs for the whole action before its outcome is resolved**, including turnovers
  and non-shooting fouls that would really end it earlier; the side-out that follows is short to
  compensate. No shot-clock violations, no 2-for-1s, no timeouts, no intentional free-throw
  misses.
- **Loose-ball fouls on rebounds** are folded into the non-shooting foul rate (labelled only).
- **Technicals** are only rolled after a personal foul, never count as team fouls, and there are
  no bench/coach technicals or flagrant fouls.
- **No FIBA unsportsmanlike fouls and no NBA "take foul" rule:** deliberate fouls are never
  penalized beyond the normal bonus (pro still applies the away-from-the-play rule by fouling
  the ball handler).
- **Score design intent:** very low team scores should come from team quality and tactics (bad
  teams, tanking), never from inflating bad teams' scoring to meet a target; the "under 70"
  check (≤ 1% of team-games) applies to typical league games only.
- **Kick-out resets** pick a fresh ball handler rather than the rebounder.
- **Composure on the road** doesn't affect free throws (only clutch time does).
- **Fast-break points** count only the transition action itself (not a putback after it); if the
  trailing defense fouls intentionally on a break, those free throws count as fast-break points.
- Jump balls during play and injuries aren't modelled. Defensive team rebounds aren't tracked
  (only the offensive team rebound from a block out of bounds).
- Tendencies are derived from attributes; the team system (above) scales the play mix, but there are no per-player coach instructions yet.

## Generated players and teams

`src/core/data/` holds the random generator used by the tools and tests:

- **Archetypes** guard / wing / big tilt attributes (centered biases, so archetype changes the
  shape of a player's ratings, not their level) and body type (heights ≈ 191 / 201 / 210 cm).
- **Quality** = mean visible rating; per-player level noise (SD 1) and per-attribute noise (SD 2).
- **Hidden attributes** are random around average. Current Ability is a **placeholder** derived
  from the mean visible rating until the CA budget system exists.
- **Teams:** 10 players; starters G, G, W, W, B; bench 1.5 rating points weaker.
