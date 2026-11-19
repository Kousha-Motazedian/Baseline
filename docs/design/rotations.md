# Rotations and Fatigue

Design reference for in-game minutes: who plays, for how long, and what tiredness does to them. Code will live in `src/core/tactics/` (the coach's rotation plan and substitution decisions) and `src/core/match/` (fatigue and the hooks that apply it). Builds on [coaches.md](coaches.md) (sections 2 and 5) and [match-engine.md](match-engine.md).

**Status:** agreed for the first implementation.

## Why now

- **Starters play about 38 minutes and the bench barely plays.** That makes individual box scores far too extreme (league averages are fine): the top scorer averages about 35 points, 43% of games have a 40-point scorer (real: about 10–16%) and 13% a 50-point scorer.
- **Two stopgaps stand in for rotations** and should go: foul-trouble benching (`foulTrouble.ts`) and blowout easing (`blowout.ts`).
- **The coach's rotation settings** (Rotation depth, Starter minutes) and his Rotation Management, Player Evaluation and Works With Youth attributes are stored but do nothing yet.

## 1. Fatigue (in-game)

Each player has **energy** from 0 to 100, starting each game at 100.

- **Drain while on the floor**, per second of game clock. **Stamina** sets the rate: Stamina 20 drains about half as fast as Stamina 1. Pace and the team's system add a little: a fast pace, pushing in transition and aggressive pressure all drain faster (that's their hidden cost).
- **Recovery on the bench**, faster than the drain, so a short rest restores most of it. Extra recovery at quarter breaks, and more at halftime.
- **Effect:** a log-odds penalty on everything the player does at both ends (shooting, ball security, contests, rebounding), growing as energy drops. Small while energy is high, steep once a player is exhausted. **Hustle** softens how much the effort side fades.
- **Calibration target:** a player who plays 40+ minutes is noticeably less efficient late in the game than the same player at 34 minutes; a fresh bench player can beat a tired starter of slightly higher rating.
- **Out of scope:** fatigue that carries over between games (back-to-backs, heavy minutes over a season, load management). It needs the schedule and calendar, and pairs with injuries.

## 2. The coach's rotation plan (before the game)

The head coach builds a **depth chart** and **target minutes** from the roster, his system and his attributes.

- **How he rates players (Player Evaluation).** The coach ranks players by a _perceived value_ that blends what they really bring (their ratings and fit in his system, the same numbers the engine uses) with their **reputation (CA)**. A high-Player Evaluation coach goes mostly by real value; a low one mostly by reputation, so he may start a famous name over a better-fitting role player. This is where CA can affect minutes (never the sim itself), in line with the CA rule in [coaches.md](coaches.md) ("What's already decided").
- **Works With Youth.** Young players (23 and under) get a bonus or penalty in his perceived value: a low-Works-With-Youth coach sits a promising rookie behind a worse veteran; a high one gives him real minutes.
- **Rotation depth** (Tight 8 · Normal 9 · Deep 10) sets how many players get regular minutes.
- **Starter minutes** (Ride the starters · Balanced · Share minutes) sets the PLAN's starter minutes: 37 / 34 / 31 on average (scaled to the league's game length), with the rest spread over the bench by perceived value. The realised minutes land about 3 to 6 below the plan (about 30-33 for a league of mixed settings) because fatigue rests starters, foul trouble sits them, and the garbage time of blowouts takes the leader's starters out; the plan is deliberately higher than the target so the realised average hits the calibration target (section 5).
- **Positions.** Starters are the best perceived five that make a valid lineup (one ball handler, at least one big: uses players' positions from [player-roles.md](player-roles.md)). Substitutes come from the same position group, replacing today's "closest height" proxy.
- **Closers.** The best perceived five for the end of close games (often but not always the starters).

## 3. Substitutions (during the game)

Subs happen at **dead balls** (the engine already checks at each possession start and after each foul).

- **Normal pattern:** starters open each half; the coach brings bench players in by fatigue and by each player's minutes so far against his target, so the minutes come out close to the plan with game-to-game variation.
- **Rotation Management** controls how well this works. A high rating subs a player before he's badly tired and keeps minutes close to the plan; a low rating reacts late (players stay on tired) and drifts from the plan.
- **Foul trouble** (replaces the stopgap): the coach sits a player who reaches a period's foul threshold (pro: 2 in Q1, 3 in Q2, 4 in Q3, 5 in Q4; scaled for FIBA) and brings him back later. Late in close games everyone plays. **Game Management** decides how strictly he follows the rule: a low one sits stars too long; a high one gambles sensibly. The existing "one foul from disqualification, play it safe" caution stays: it's player behaviour, not a stopgap.
- **Garbage time** (replaces blowout easing): with a big, safe lead (the same lead-safety measure the stopgap uses), mostly in the fourth quarter, both coaches go to their benches: the rotation bench first, and players the plan gives no minutes only once the game is decided. The lower-rated bench does the work the effort penalty used to do.
- **Close games:** in the last minutes of a close game the coach plays his closers regardless of minutes, as long as they're not exhausted.
- **Disqualifications and injuries** (injuries later) fall back to the depth chart for the replacement.

## 4. Your override (GM)

- **By default the coach runs the rotation.** Rotation depth and Starter minutes are system settings, so you can override them like any other (with the familiarity penalty from coaches.md section 4).
- **You can take over the rotation instead.** You then set the starting five, the bench order and target minutes per player. The coach still makes the in-game calls (subbing for fatigue, foul trouble, garbage time and closing lineups) and follows your plan as closely as his Rotation Management allows.
- **No cost in 1.0.** Taking over the rotation gives no sim penalty. Once coach morale exists (2.0), a coach may get annoyed when you take over.
- You can hand the rotation back to the coach at any time.

## 5. Calibration targets (batch-sim gains player-level checks)

| Metric                                     | Target (pro)                                                     |
| ------------------------------------------ | ---------------------------------------------------------------- |
| Starter minutes (team average)             | 30–33                                                            |
| Most minutes on a team, per game           | 34–38                                                            |
| Players with 10+ minutes per team-game     | 8–10                                                             |
| Team top scorer, points per game           | 26–29                                                            |
| Games with a 40+ point scorer              | 10–16%                                                           |
| 50+ point games per game                   | ≤ 0.02                                                           |
| Team leader in rebounds / assists per game | about 10–12 / 7–9                                                |
| League averages (existing targets)         | all still pass                                                   |
| Final-margin spread, identical teams       | derived, about 14.0–16.0 (see match-engine.md)                   |
| League games: average margin of victory    | 11.9–12.9 (real 12.4)                                            |
| League games: decided by 20+               | 17–22% (real 19.5%)                                              |
| League games: margin SD                    | 14.5–16.5 (real ~15.5)                                           |
| Substitutions per game (both teams)        | 40–55 (real 40–50)                                               |
| Players the plan gives 0 min: share of min | ≤ 6% (real 3–6%); ≤ 2 min per team-game in games decided by < 10 |

Also in this step:

- **Coach systems drift (final review M3):** rebalance the archetype mix (two of six press aggressively, none conservative; three get back on the glass, one crashes) so a fully coached league averages out to the targets, and re-measure the systems calibration at 1,600+ games.
- **If box scores are still too extreme** after rotations, tune usage concentration (`USAGE_EXPONENT`) or the generator's spread, as the TODO entry says.
- The byte-identity guarantee ends here: rotations change every game, so a new golden hash is recorded after this step.

## 6. Decisions (agreed 2026-11-15)

1. **GM control:** the coach runs the rotation by default; you can take it over and set starters, bench order and minutes, at no cost in 1.0 (section 4).
2. **Timeouts and end-of-game decisions** (Game Management: when to foul, last shot, 2-for-1s, timeouts to stop runs or rest players) are a **separate next step**. They are the levers for the overtime gap.
3. **Player Evaluation strength:** at Player Evaluation 1 the coach's perceived value is 70% reputation / 30% real value; at 20 it's 10% / 90%, linear in between.

## 7. Out of scope for this step

- Fatigue across games, load management and injuries.
- Timeouts and end-of-game strategy (the next step).
- Player morale about minutes (2.0).
- Live in-game substitutions by the user (2.0).

## 8. Implementation notes: tactics side (`src/core/tactics/rotation*.ts`)

Files: `rotationTypes.ts` (contract types), `rotationTuning.ts` (every constant), `rotationValue.ts` (perceived value), `rotationPlan.ts` (plan, override), `rotationSubs.ts` (in-game), `rotation.ts` (public re-exports). Tuning was matched to the box-score targets after the merge; the values below are the final ones (section 9 has the calibration story).

**Contract addition:** `buildRotationPlan(roster, coach, system, override?, rules = PRO_RULES)`. The fifth parameter is optional and supplies the game length for the minute budget (240 = periods x periodSeconds x 5 for pro). The engine should pass its rules so FIBA games get 200 player-minutes.

**Perceived value (1-20 scale).** `real = best position rating + 2 x (offense fit + defense fit)/2` (fit is -1..+1, never CA). `reputation = CA` mapped from 1-100 to 1-20. `perceived = r x reputation + (1 - r) x real + youth`, with `r = 0.7 - 0.6 x (PE - 1)/19`. Youth: players aged 23 or under get `2 x (WWY - 10.5)/9.5` rating points. Closers use `r - 0.15` and no youth term (in the finish a coach trusts what he sees).

**Starters and closers.** Exhaustive search over the top 8 by value, assigning slots PG..C to maximise `value + slotCost`; slotCost is minus the rating points below the player's best position, or -8 if his height rules the slot out. That makes a ball handler and a big appear through the PG and C slots without a hard rule.

**Targets.** Rotation size 8 / 9 / 10 (tight / normal / deep). Starter average 37 / 34 / 31 minutes for ride / balanced / share (scaled to the game length), spread by perceived value at 0.6 min per rating point, capped at +-3. The remaining player-seconds go to the bench with each next player getting 0.75x the previous one's share. Players outside the rotation get 0. With no bench the starters split the game. Targets always sum to the game total.

**Override.** Valid, de-duplicated ids only; starters topped up from the coach's five if fewer than 5; order = starters, then the GM's order, then the coach's; targets exactly as given (missing = 0); closers stay the coach's.

**In-game utility** (picks who should be on the floor; one swap per slot at a time):

- normal: `-0.25 x rank + w x minutesOwed + fatiguePenalty - 3 (if target 0)`, where `minutesOwed = (target x gameFraction - played)/60` and `w` runs 0.35 (RM 1) to 1.0 (RM 20).
- fatigue: `-0.4` per energy point below a tired line of 30 (RM 1) to 60 (RM 20), so a sharp coach rests players before they are badly tired.
- finish (last 5 min x 0.75-1.25 by GM, margin <= 8 and |leadSafety| < 1.5, or overtime): normal utility plus 6 for closers with energy >= 25.
- garbage (fourth quarter, or the third with 1.5x the lead and safety): the LEADER goes to his bench at a lead of 10+ points with |leadSafety| >= 2.0 (GM 1) to 1.2 (GM 20); the TRAILING coach concedes only at 1.65x that lead and safety (`GARBAGE_TRAILING_FACTOR`). Hysteresis: once at least four bench players (rotation rank 6+) are on the floor, the lead and safety only have to stay at 60% of those. Then `+1 x rank` plus fatigue, so the rotation bench enters in order; players the plan gives no minutes carry a -12 cost until |leadSafety| >= 4.5 (the game is decided). Up to 5 swaps at once.
- A swap happens only if the entrant beats the occupant by an incumbent bonus of 2.5 (the anti-churn hysteresis; it gives roughly 3-6 minute stints). Normal pattern: at most 2 swaps per call. One rng draw per call decides whether the coach is watching (50% at RM 1, 100% at RM 20); a coach who isn't watching still makes forced swaps.
- Fouls: threshold `round((period + 1) x limit/6)`, clamped to [2, limit-1], none in overtime (pro: 2/3/4/5; FIBA: 2/3/3/4). Cautious coaches (GM <= 6) sit top-5 players one foul earlier, gamblers (GM >= 15) one later. A sitter may return when the period has under 10% (GM 1) to 45% (GM 20) of its time left; no sitting in the finish. Stateless on purpose. Disqualified or sitting players are ineligible (utility -1000) and are always swapped out when someone eligible exists.
- `chooseReplacement` picks the best entrant for a slot by the same utility (plan order, position fit, fatigue), never on-court, disqualified or sitting.

## 9. Integration and calibration notes (engine + tactics merged)

- Final constants and measured results are in [match-engine.md](match-engine.md) ("Calibration with rotations"). Plan starter minutes are 37 / 34 / 31 (ride / balanced / share). Realised minutes come out 3-6 lower (rest, foul trouble, garbage time), landing at 30-33.
- **Garbage time (review fix M2).** The first version started at a 12-point lead anywhere in the second half and put the deepest players in first, so players the plan gave no minutes played ~15% of all minutes (11-12 player-minutes even in games decided by under 8). Now: mostly the fourth quarter, hysteresis, the rotation bench before the 0-minute players, and those wait until the game is decided. Zero-plan players now play 4.5-4.8% of minutes and ~1 player-minute per team-game in close games. The trailing coach concedes later (1.65x); that asymmetry is what keeps the league margin at the real 12.4 average with 19.5% decided by 20+ (symmetric: 13.4+ / 25%+).
- **Rotation Management (review fix M1).** Narrower knobs (`PACE_WEIGHT_AT_RM_1/20` 0.3 / 0.55, `ATTENTION_AT_RM_1` 0.85, `TIRED_LINE_AT_RM_1/20` 38 / 55). Probe: substitutions per game 39.8 / 47.9 / 54.6 at RM 1 / 10.5 / 20 (was 44 / 65 / 86), plan gap 5.47 / 4.98 / 4.76 minutes, minutes on the floor under 40 energy 5.0 / 0.6 / 0.0 per team-game. `OUT_OF_ROTATION_COST` is 10 (above the 8-point slot misfit, so an unused bench center does not replace the starting center).
- Fatigue drain 0.07/s at Stamina 1 (half at 20), bench recovery 0.15/s, +8 at quarter breaks, +25 at halftime.
- **Coach attribute strengths (measured, 3,000 games, same roster).** Rotation Management 20 vs. 1 is worth about **+5.3 points per game** (63% wins); Offensive Coaching 20 vs. 1 about +2.1; Game Management 20 vs. 1 about +1.0. Rotation Management is the strongest single coach attribute because it decides who is on the floor and how tired he is across the whole game, which the ordinary coaching attributes do not touch. **Decision (user): keep it.** Revisit only if AI coach hiring ends up ignoring it or it dominates the market.
- **The bridge** (`src/core/tactics/matchTeam.ts`): `matchTeamFor(team, { coach?, system?, rotationOverride?, rules? })` returns the team with `coaching` (`coachingInputs`), `rotation` (`buildRotationPlan(roster, coach, system, override, rules)`) and `rotationCoach` (`rotationCoachOf`) filled in. Use it everywhere a game is built from a club; before this fix nothing outside the tests turned a head coach into a game, so batch-sim only ever calibrated a neutral coach. `batch-sim --league-systems` now generates a real coach per team.
- The CA rule: the head coach may read CA (reputation) when choosing minutes, so the "CA never affects the simulation" tests pin the rotation plan and then change only CA/Potential.
- Performance: `bestFive` precomputes value and slot costs; position ratings and per-decision utilities are cached.
