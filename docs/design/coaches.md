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

**Strength:** perfect fit vs. poor fit is worth about the same as 1 rating point across the roster (roughly 3–4 points of net rating), so system choice matters but can't make a bad roster good.

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

- Coaches have **contracts with a salary and a length**. Salary demands come from the coach's Reputation and record.
- Until full staff finances arrive (3.0), each team has a **coach cap**: the most it can spend on coaching salaries per season. It is league config in `LeagueRules`, separate from the player salary cap.
- **Firing is free for now:** a fired coach's remaining salary does not count against the coach cap. It will once full team finances arrive in 3.0 (tracked under Full team finances in `docs/TODO.md`).
- AI teams follow the same cap.

## 7. Out of scope for this step

- Assistant coaches and other staff (2.0).
- Coach morale, relationships with players, and press conferences (2.0).
- Coach-only and dual-role careers (2.0 / 3.0).
- Live in-game control by the user (2.0).
