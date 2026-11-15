# Coaches

Design reference for head coaches in Baseline 1.0. Code will live in `src/core/staff/` (coach model) and `src/core/tactics/` (systems). Builds on [player-roles.md](player-roles.md).

**Status:** agreed for the first implementation.

## What's already decided

- Every team has a **head coach** with attributes and their own **playing style and system**.
- You (the GM) can **hire and fire** your head coach.
- The coach's system is the team's **default tactics**; you can **override** it.
- **CA/reputation never affects the simulation.** Coaches may _use_ reputation in their decisions (who starts, who gets minutes), but a player's sim strength comes only from attributes and how well his role fits the system. A well-coached team of role players can beat a star-heavy team (the 2010s Hawks).
- Assistant coaches, trainers, medical and analytics staff are Baseline 2.0. Coach-only careers are 2.0; the dual GM + coach role is 3.0.

## 1. Coach attributes (1–20, like players)

| Attribute           | Drives                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offensive Coaching  | How well the team executes the offensive system (a small edge on offensive play outcomes)                                                                             |
| Defensive Coaching  | How well the team executes the defensive scheme (a small edge on defensive outcomes)                                                                                  |
| Tactical Knowledge  | How well he matches the system to the roster and adjusts to opponents; how much he loses when forced off his preferred system                                         |
| Game Management     | Timeouts, end-of-game decisions (fouling, holding for the last shot, 2-for-1s), reacting to runs                                                                      |
| Rotation Management | Handling fatigue and foul trouble; giving minutes to the right players                                                                                                |
| Player Evaluation   | How much he trusts actual ability vs. **reputation** when picking starters and minutes. Low = plays big names; high = plays whoever is actually better or fits better |
| Motivation          | Effort and consistency of his players (a small reduction in game-to-game variance); later feeds morale (2.0)                                                          |
| Player Development  | Speed of player development (used once development exists)                                                                                                            |
| Discipline          | Technical fouls and rule-breaking by his players; sticking to the game plan                                                                                           |
| Works With Youth    | Whether he is comfortable giving minutes to young players or always sticks with veterans. Low = vets get the minutes; high = young players get real chances           |

Hidden, like players' hidden attributes: **Reputation** (1–100, what the league thinks of him; drives his salary demands and job offers later) and **Adaptability** (willingness to change his system when the GM overrides it).

Coach attributes are shown **exactly** (not as scouted ranges).

## 2. Playing style and system

A coach's system is a set of tactical settings. The coach has a **preferred** setting for each; together they are the team's default tactics.

**Offense**

| Setting              | Options                                                               |
| -------------------- | --------------------------------------------------------------------- |
| Pace                 | Slow · Balanced · Fast                                                |
| Shot profile         | Inside-out (paint and post) · Balanced · Three-point heavy            |
| Ball movement        | Isolation / star-driven · Balanced · Motion / ball movement           |
| Primary action       | Pick-and-roll · Post-ups · Off-ball cuts and screens · Drive-and-kick |
| Transition           | Get back on defense · Balanced · Push in transition                   |
| Offensive rebounding | Get back · Balanced · Crash the glass                                 |

**Defense**

| Setting                | Options                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| Scheme                 | Man-to-man · Switch everything · Zone                              |
| Pick-and-roll coverage | Drop · Hedge/show · Switch · Blitz                                 |
| Pressure               | Conservative (contain) · Balanced · Aggressive (gamble for steals) |
| Help priority          | Protect the paint · Balanced · Run shooters off the line           |

**Rotation tendencies**

| Setting         | Options                                      |
| --------------- | -------------------------------------------- |
| Rotation depth  | Tight (8) · Normal (9) · Deep (10–11)        |
| Starter minutes | Ride the starters · Balanced · Share minutes |

Generated coaches get coherent systems from a few **archetypes** (e.g. "Pace and Space", "Grit and Grind", "Motion Offense", "Star-Driven", "Defensive Disciplinarian", "Small-Ball"), with some variation, so the league has a mix of identities.

Youth vs. veterans is not a system setting: it comes from the coach's **Works With Youth** attribute.

**Scope for the first implementation:** pace, shot profile, ball movement, primary action, transition, offensive rebounding, defensive pressure, help priority and the rotation settings. Defensive schemes and pick-and-roll coverages (zone, switching, drop/hedge/blitz) need new engine work and come later (late 1.0 or 2.0); until then every team plays man-to-man.

## 3. How a system affects the simulation (role fit)

This is what makes the Hawks principle real.

- Each system setting wants certain **roles** and **attributes**. A three-point-heavy system wants Sharpshooters, 3-and-D Wings and Stretch Bigs; protect-the-paint wants a Rim Protector; aggressive pressure wants Lockdown Defenders and Stealing; push-in-transition wants Speed.
- The engine already uses tactics-like inputs (play-type mix, pace). The system changes those inputs: a three-point-heavy system raises the share of threes, a motion offense raises the assisted share, and so on.
- **System fit:** each player gets a fit score for the current system from his role and attributes. Good fit gives a small positive edge in the engine; poor fit a small negative one. Fit is about _what a player does well_, never his CA.
- **Coach execution:** Offensive/Defensive Coaching add a small edge on top, scaled by how well the coach knows the system being run.

The effect sizes are tuned with batch sims: a well-fitted team of average players should beat a poorly fitted team with slightly better players often enough to be visible, but talent still matters most.

**Strength:** perfect fit vs. poor fit is worth roughly 3–4 points of net rating (about the same as half a rating point across the roster; +1 on every attribute is worth about 8 net rating), so system choice matters but can't make a bad roster good.

## 4. Your override

You can change any system setting, at a cost: a **familiarity penalty**. The coach executes his own preferred settings best. For each setting you override, his execution bonus for that part drops, scaled by his Adaptability and Tactical Knowledge. So hiring a coach who already wants your system matters, and an adaptable coach handles your changes well.

Coach pushback (frequent overrides annoying him, asking to leave) needs morale and arrives with it in 2.0.

## 5. In-game decisions (coach, not you)

In 1.0 you are the GM, so during the game the **head coach** makes the calls using his attributes:

- Substitutions and minutes (Rotation Management, rotation tendencies, Player Evaluation).
- Foul trouble and fatigue (replaces the engine's foul-trouble stopgap).
- Garbage time (replaces the blowout-easing stopgap).
- Timeouts and end-of-game strategy (Game Management): when to foul, holding for the last shot, 2-for-1s. These are the levers the overtime gap needs.

Live in-game decisions by the user are Baseline 2.0 ("Live match decisions").

## 6. Hiring and firing (1.0)

- A **coach pool** of unemployed coaches, generated at league start and refreshed each season (retired players becoming coaches is 2.0).
- You can **fire** your coach at any time and **hire** from the pool. A coach shows his system archetype, settings, record and exact attributes.
- AI teams also fire and hire coaches based on results.

### Coach contracts and the coach cap

- Coaches have **contracts with a salary and a length**. Salary demands come from the coach's **ability and Reputation** (70% reputation, 30% ability; record-based demands come once season records exist). A good coach with a low reputation is a bargain, but doesn't ask for the minimum either: what the league thinks still counts most, so a good evaluator finds real value.
- Until full staff finances arrive (3.0), each team has its own **coach cap**: the most it can spend on coaching salaries per season. It depends on how rich the team is: its **Market Size** and its **Owner Wealth**. Rich, big-market teams can afford the most famous coaches; poor, small-market teams have to find bargains. The league's cap range is config in `LeagueRules`, separate from the player salary cap.
- **Firing is free for now:** a fired coach's remaining salary does not count against the coach cap. It will once full team finances arrive in 3.0 (tracked under Full team finances in `docs/TODO.md`).
- AI teams follow the same cap.

### Implementation notes (coach model)

Code: `src/core/staff/` (`types.ts`, `coachGenerator.ts`, `contracts.ts`, `market.ts`, `hiring.ts`).

- **Generation.** Each coach has an overall **quality** on the 1–20 scale (league mean 10.5, SD 2.5, kept within 4–17). Every attribute is drawn around it with SD 2.5 (wider than players' 2, so coaches have clear strengths and weaknesses), plus a small archetype lean (e.g. Defensive Disciplinarian: better Defensive Coaching and Discipline), centered so it shapes the attributes without raising the level. Age is about 52 ± 8, within 35–70. Adaptability is drawn on its own, independent of quality.
- **Reputation** = 50 + 6 × (quality − 10.5) + 0.3 × (age − 52) + noise (SD 10), within 1–100. It correlates with quality at about 0.7 to 0.8, so overrated and underrated coaches exist. It only drives salary and AI hiring, never the sim.
- **Team wealth** (new, in `src/core/finances/`): every team gets **Market Size** and **Owner Wealth**, each 1–20 (mean 10.5, SD 4, mildly correlated at about 0.3, because big markets tend to attract rich owners). Both are generated with the league and kept for full team finances (3.0). The GM sees them exactly. Owner Wealth belongs to the owner, not the franchise: when team sales arrive in 3.0, a new owner brings his own wealth, so the team's coach cap can rise or fall.
- **Coach cap per team.** Financial power = (Market Size + Owner Wealth) / 2. Cap = min + (max − min) × (power − 1) / 19, rounded to 1,000. The range is `LeagueRules.coachCapRange` (replacing the single `coachCap`): Pro USD 6,000,000–15,000,000 (an average team 10.5M), FIBA EUR 600,000–1,500,000. That's a 2.5× spread between the poorest and richest teams. For now only the head coach counts against it; assistants join this budget in 2.0.
- **Salary demand.** Value = 0.7 × (reputation / 100) + 0.3 × ((mean attribute − 1) / 19). Demand = max cap × (0.1 + 0.9 × value²), rounded to 1,000, where max cap is the top of the league's range, so a demand never exceeds the richest team's cap. Squared because coaching pay is top-heavy. Demands are the same whichever team asks. Pro examples: an average coach (reputation 50, attributes 10.5) asks about 4.9M; an unknown great coach (reputation 25, attributes 16) about 3.8M; a famous good coach (reputation 80, attributes 14) about 9.4M, beyond the poorest teams' caps; reputation 100 with top attributes 13.8–15M, which only the richest teams can afford. The cheapest demand (1.5M) is below the lowest cap (6M), so every team can always hire someone.
- **Affordability.** A team can hire a coach only if its current coaching spending plus his demand fits its own cap. The cap comes from `teamCoachCap(finances, rules)`; `canTeamAffordCoach`, `hireCoach`, `chooseCoachToHire` and `aiHireCoach` all take the team's `TeamFinances`. The AI hires the best coach it can afford (same reputation-first ranking).
- **Contract length** is 1–5 seasons. When the AI hires, coaches aged 65 or older sign for at most 2, and coaches with reputation 60 or more won't sign for 1. The GM can sign a coach for any length from 1 to 5 seasons (a deliberate GM perk, decided in the final review; `hireCoach` only checks the 1–5 band).
- **Market.** `CoachMarket` holds `headCoaches` (by team id), `pool` and `firedBy` (the coach ids each team has fired, see Hiring and firing). `assignLeagueCoaches` gives every team a new coach (ids `HC1`…) and builds a pool of 0.4 × teams (12 for 30 teams; ids `FA1`…). Pool coaches have a lower mean quality (9.5), because the best coaches mostly have jobs. Initial assignment respects each team's cap: `assignLeagueCoaches` takes every team's finances; a team whose drawn coach asks more than it can afford gets a replacement drawn from the same distribution (up to 25 tries, new ids after the last `HC` id; the pricey coach is simply not in that league), so it stays deterministic.
- **Hiring and firing** are pure functions. `fireCoach` is free and sends the coach back to the pool. `hireCoach` needs a vacant job, a pool coach and a cap fit; he signs at his demand. The AI (`chooseCoachToHire` / `aiHireCoach`) ranks by reputation, then by mean attribute, then by id, so it leans on reputation like a weak human evaluator. **No boomerang hires:** `fireCoach` records the coach in `CoachMarket.firedBy[teamId]`, and the AI skips him for that team (other teams may hire him, and the GM's own `hireCoach` is unrestricted). If he was the only affordable option the job stays vacant. The exclusion lasts until `clearFiredHistory(market)` runs at the season rollover's pool refresh. `shouldFireCoach(record, expectations)` fires a coach whose win percentage falls more than the tolerance (default 0.15) below expectations. Calling it is left to the season loop, which doesn't exist yet.

## Implementation notes: systems, fit and override (calibration)

Code: `src/core/tactics/` (`system.ts`, `effects.ts`, `fit.ts`, `coaching.ts`, `tuning.ts`); engine hooks are listed in [match-engine.md](match-engine.md). So far the engine reads only Offensive Coaching, Defensive Coaching, Tactical Knowledge and Adaptability; the other seven attributes and the rotation settings are generated and stored but have no effect until rotations, in-game decisions and development exist. All effect sizes live in `tuning.ts`. Measured with `npm run sim:batch -- --systems` (400 paired games per row, report only):

- **Fit size.** Perfect vs. poor fit (`FIT_EDGE` ±0.02 log-odds on each player's own actions) is worth **+3.40 net rating** per 100 possessions (target 3–4). The best vs. the worst coach (`EXECUTION_EDGE` ±0.02) is also +3.40. For scale, +1 on every attribute is worth +7.9 net rating, so the fit swing equals about 0.43 attribute points (target agreed as 3–4 net rating, i.e. about half a rating point).
- **Realistic rosters fit all systems about equally.** Generated rosters aren't built around a system, so the best- vs. worst-fitting archetype for a random team differs by only +0.40 net rating (starters' fit gap 0.22), and the Hawks test (fitted average team vs. poorly fitted +0.5 team) is unchanged at A winning 0.357 with or without systems. The full fit swing only shows for rosters built or coached for a system (AI roster building and GM choices, later steps).
- **Familiarity (section 4).** Overriding every setting costs a rigid coach (Adaptability and Tactical Knowledge 1) -2.24 net rating and an adaptable one (20/20) -0.44.
- **Options are trade-offs, not free buffs.** Net rating of each option alone, vs. balanced, for an average roster: within about ±1.5 (largest: conservative pressure -1.5, getting back on the glass -1.5, crashing +1.6, fast pace -1.2, post-ups -1.2). Their stat moves are as intended (e.g. three-heavy +8.2 pts of 3PA share, fast +7.4 possessions, crash +6.4 ORB%).
- **League averages** (2,000 games, no coaching = unchanged engine): all targets pass except overtime rate (0.044, the known overtime gap, owned by the in-game decisions step). Balance tests: offense:defense 1.40 (target 1.30-1.50), +3 everywhere shifts the league +0.98 (within ±2). With `--league-systems` (every team a random archetype, average coach) two more targets land just outside their range: ORB% 0.227 (target 0.23-0.27, 0.233 without coaching) and steals 8.00 (limit 8.0, 7.24 without coaching); turnovers rise from 12.5 to 13.3 per 100 possessions and overtime is 0.040. The drift comes from the archetype mix (two of the six press aggressively and none plays conservative; three get back on the offensive glass and one crashes). Not tuned further yet; re-check when coaches are wired into league games.

## 7. Out of scope for this step

- Assistant coaches and other staff (2.0).
- Coach morale, relationships with players, and press conferences (2.0).
- Coach-only and dual-role careers (2.0 / 3.0).
- Live in-game control by the user (2.0).
