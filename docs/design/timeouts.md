# Timeouts and End-of-Game Decisions

Design reference for the head coach's late-game and timeout decisions. Code will live in `src/core/tactics/` (the coach's decisions) and `src/core/match/` (timeout mechanics and the hooks). Builds on [coaches.md](coaches.md) (section 5), [rotations.md](rotations.md) and the late-game section of [match-engine.md](match-engine.md).

**Status:** agreed for the first implementation.

## Why now

- **Overtime is still too rare** (about 4% of games vs. a 5–7% target). The engine already has late-game clock management, last shots and intentional fouls, but no timeouts and no 2-for-1s. Those are the missing levers.
- **Game Management does almost nothing yet.** It only tweaks foul-trouble and closing-lineup timing from the rotations step.
- **Every late-game decision is the same for every team.** A good coach should handle the last minutes better than a poor one.

## 1. Timeouts (league rules)

Timeout allowances are `LeagueRules` data, not code:

|                                  | Pro                                                | FIBA                                          |
| -------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| Per game                         | 7                                                  | 2 in the first half, 3 in the second          |
| Late limits                      | at most 4 in the 4th quarter, at most 2 after 3:00 | at most 2 in the last 2:00 of the 4th         |
| Overtime                         | 2 each                                             | 1 each                                        |
| Advance the ball after a timeout | yes, in the last 2:00 of the 4th and overtime      | yes, in the last 2:00 of the 4th and overtime |

Pro timeouts are one pool for the whole game (within the late limits). FIBA timeouts left unused in the first half are lost. Each overtime gives a fresh allowance; whether unused regulation timeouts carry into overtime is a rules setting (FIBA: they don't).

## 2. What a timeout does

- **Stops the clock.** Late in a game the trailing team calls one after the opponent scores, instead of letting the clock run while it inbounds.
- **Advances the ball** (last 2:00): the offense inbounds in the frontcourt, saving about 4–6 seconds of game clock.
- **Rest:** every player gets a short energy recovery, and the coach can substitute.
- **A drawn-up play:** the next possession gets a small execution edge, scaled by the coach's **Game Management** (good coaches are known for after-timeout plays).
- **No momentum system.** Research finds timeouts barely stop runs: they mostly look like they work because runs end anyway. So a timeout "to stop a run" gives only the rest and the drawn-up play, not a separate momentum effect.

## 3. When the coach calls a timeout

The coach decides, using **Game Management**:

- **Late-game clock:** trailing late, after the opponent scores or to advance the ball for a last shot. Leading, rarely (only to avoid a turnover).
- **Rest and runs:** after an opponent run (e.g. 8–0) or when his players are tired, if he can spare one (he keeps some for the end).
- **Last possession:** to set up the final shot of a close game.
- **Game Management sets the quality:** a high one saves timeouts for the end and uses them at the right moments; a low one burns them early, sometimes has none left when he needs one, and occasionally forgets to call one late.

## 4. End-of-game decisions (Game Management)

The engine's existing late-game rules become the coach's decisions, done well or badly by Game Management:

- **When to foul when trailing:** a good coach fouls at the right deficit and time (today's rules); a poor one starts too late or keeps fouling after the game is gone.
- **Fouling when up 3** in the last few seconds (to stop a tying three): a good coach does it; a poor one doesn't.
- **2-for-1** (new): with about 28–40 seconds left in a period, take a quick shot to get the last possession too. A good coach does it consistently; a poor one rarely.
- **Holding for the last shot and the trailing team's quick shot:** existing rules, with a poor coach sometimes holding too long or shooting too early.
- **Down 3: go for two or three:** the existing tying-two preference, applied more or less well.
- **Calibration target:** a top Game Management coach wins close games (within 5 in the last 5:00) about 5 percentage points more often than a poor one, with talent equal.

## 5. Calibration targets

| Metric                                              | Target (pro)        |
| --------------------------------------------------- | ------------------- |
| Overtime rate                                       | 5–7%                |
| Timeouts used per team-game                         | about 6 of 7        |
| 2-for-1s per team-game                              | about 1–2 attempted |
| Close-game win rate, top vs. poor Game Management   | about +5 points     |
| League averages and player-level targets (existing) | all still pass      |

## 6. Decisions (agreed 2026-11-15)

1. **After-timeout play:** the possession after a timeout gets a small execution edge, scaled by Game Management.
2. **No GM control in 1.0:** the coach makes all timeout and end-of-game calls; live decisions by the user come in 2.0.
3. **Game Management strength:** the best coach wins close games about 5 percentage points more often than the worst, talent equal.

## 7. Out of scope for this step

- Live in-game control by the user (2.0).
- Challenges / coach's challenge, video review.
- Intentional missed free throws.
- Bench and coach technical fouls.

## 8. Implementation notes: the coach's timeout decision

Code: `src/core/tactics/timeouts.ts` (`decideTimeout(ctx, rng)`), constants in `src/core/tactics/timeoutTuning.ts`.

- Always draws exactly two RNG numbers (forget roll, act roll) so the stream does not depend on the situation. Never calls one with `timeoutsLeft` 0.
- **Late window** (final period/overtime, last 5:00, windows shrink on short periods): trailing and not hopeless (`leadSafety` above -2.5): last 28s with the ball within 3 -> `lastPossession`; after an opponent score -> `stopClock`; last 2:00 with the ball, down at most 8 or tied -> `advanceBall`. Leading: only a 4% chance in the last 20s with the ball and a lead of 3 or less. Each acts with a chance that grows with Game Management, and a "forgot" roll (30% at GM 1, 2% at GM 20) cancels it. Late timeouts may use every timeout he has.
- **Run/rest** (everywhere else): only if `timeoutsLeftTotal` exceeds his reserve. Reserve = round(max(mid, end)): mid is 1 (GM 1) to 4 (GM 20) scaled by regulation left; end is 0 to 3 and holds through the final period. `stopRun` after an opponent score when the run reaches 6 (GM 1) to 10 (GM 20) points, 75% chance; `rest` when lowest on-court energy is under 42 (GM 1) to 28 (GM 20) or average under 50, 50% chance.
- Calibration (about 6 of 7 used) is measured in batch-sim; adjust the reserve and the call chances in the tuning file.
