# Player Attributes

Design reference for how players are rated. Code lives in `src/core/players/`.

**Status:** agreed for the first implementation. Expect revisions once tactics are implemented (especially tendencies and positions).

## Principles

- **Every attribute must drive something in the simulation.** If it doesn't affect the match engine, development, morale, or another system, it shouldn't exist.
- **Attributes describe how _well_ a player does something, not how _often_.** Shot and play-type frequency comes from tactics and decision logic (see [Tendencies](#tendencies)).
- **Visible attributes use a 1–20 scale.** Each point is meaningful, it reads naturally as a scouting range ("12–15"), and it avoids fake precision.
- **Current Ability and Potential use a 1–100 scale** and act as a budget that the visible attributes must fit within.

## Measurables

Real-world values, not ratings. They act as modifiers on related attributes.

| Measurable    | Used for                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| Height        | Rebounding, finishing at the rim, shot contests, shooting over defenders |
| Wingspan      | Blocks, steals, contests, rebounding reach                               |
| Weight        | Post play, boxing out, durability; heavier players lose some speed       |
| Age           | Development and decline curves                                           |
| Dominant hand | Driving direction; flavor in play-by-play                                |
| Nationality   | Import-player limits, adaptability, national-team eligibility            |

## Visible attributes (30, scale 1–20)

### Scoring (6)

| Attribute    | Drives                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------- |
| Driving      | Attacking the basket: beating a defender off the dribble to get a rim attempt, drawing help defense |
| Finishing    | Converting at the rim once there: layups, dunks, putbacks, finishing through contact                |
| Post Scoring | Post-up effectiveness: hooks, drop steps, fadeaways                                                 |
| Mid-Range    | Make % from 10–22 ft                                                                                |
| Three-Point  | Make % from beyond the arc                                                                          |
| Free Throw   | Make % at the line                                                                                  |

**How a drive resolves:** Driving vs. the defender's Perimeter Defense + Quickness decides whether the drive succeeds → Finishing vs. the rim protector's Interior Defense + Shot Blocking decides whether it goes in → Ball Handling sets the turnover risk along the way.

### Playmaking (3)

| Attribute         | Drives                                                                   |
| ----------------- | ------------------------------------------------------------------------ |
| Ball Handling     | Turnover rate, beating pressure, creating space for jump shots           |
| Passing           | Assist chance, quality of shots created for teammates, passing turnovers |
| Off-Ball Movement | Getting open: cuts, coming off screens, spot-up readiness                |

### Defense (4)

| Attribute         | Drives                                              |
| ----------------- | --------------------------------------------------- |
| Perimeter Defense | Contest quality and containment on guards and wings |
| Interior Defense  | Post defense, rim protection other than blocks      |
| Stealing          | Steal chance on passes and dribbles                 |
| Shot Blocking     | Block chance at the rim and on jumpers              |

### Rebounding (2)

| Attribute            | Drives                                    |
| -------------------- | ----------------------------------------- |
| Offensive Rebounding | Winning offensive boards, putback chances |
| Defensive Rebounding | Finishing defensive possessions           |

### Physical (6)

| Attribute  | Drives                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| Speed      | Transition play, pace, getting back on defense                             |
| Quickness  | First step and lateral movement: beating or staying in front of a defender |
| Strength   | Post play, finishing through contact, boxing out                           |
| Vertical   | Rebounds, blocks, finishing above the rim                                  |
| Stamina    | How fast fatigue builds; how many minutes the player can play effectively  |
| Durability | In-game injury resistance (separate from hidden Injury Proneness)          |

### Mental (9)

| Attribute    | Drives                                                                    |
| ------------ | ------------------------------------------------------------------------- |
| Offensive IQ | Shot selection, reading defenses, fewer bad decisions                     |
| Defensive IQ | Help defense, rotations, taking charges                                   |
| Composure    | Performance under pressure: close games, hostile crowds, late shot clock  |
| Hustle       | Loose balls, effort plays, how fast effort fades with fatigue             |
| Teamwork     | Giving up good shots for better ones; chemistry                           |
| Leadership   | Morale effects on teammates, locker-room influence                        |
| Aggression   | Drawing fouls and attacking the rim, at the cost of committing more fouls |
| Discipline   | Foul rate, technical fouls, sticking to the game plan                     |
| Work Ethic   | Development speed in practice                                             |

## Hidden attributes

Never shown directly. Scouting reveals estimates or ranges; some (like Consistency) become apparent through observed performance over time.

| Attribute        | Scale | Drives                                                 |
| ---------------- | ----- | ------------------------------------------------------ |
| Current Ability  | 1–100 | Attribute budget; scouting, contracts, AI valuation    |
| Potential        | 1–100 | Development ceiling                                    |
| Consistency      | 1–20  | Game-to-game performance variance                      |
| Big Games        | 1–20  | Playoff and rivalry performance                        |
| Injury Proneness | 1–20  | Injury and re-injury chance                            |
| Professionalism  | 1–20  | Training habits, late-career decline, off-court issues |
| Ambition         | 1–20  | Desire to win vs. money; trade requests                |
| Loyalty          | 1–20  | Willingness to re-sign, hometown discounts             |
| Temperament      | 1–20  | Reactions to criticism, benching, media                |
| Adaptability     | 1–20  | Settling into a new country or league                  |

## Current Ability (CA) and Potential (PA)

Both share one 1–100 scale, so they read against each other: **CA 52 / PA 80** is a rotation player today with superstar upside.

| Rating | Tier                                                         |
| ------ | ------------------------------------------------------------ |
| 100    | GOAT — about one every 20–30 seasons; most seasons have none |
| 90+    | Generational                                                 |
| 80+    | Superstar                                                    |
| 70+    | All-Star                                                     |
| 60+    | Quality starter                                              |
| 50+    | Rotation player                                              |
| 40+    | End of bench / fringe top-league player                      |
| 30+    | Development league / overseas pro                            |
| 20+    | College / amateur                                            |
| < 20   | Youth prospect                                               |

**How CA connects to attributes:** CA is the points budget the visible attributes must fit within. Each attribute's cost is weighted by how much it matters for the player's position/role, so an elite center can't also be an elite ball-handler for free. When CA rises, attributes rise to match, so a CA 70 player genuinely plays like an All-Star.

**The match engine never reads CA directly**; it simulates from attributes. CA/PA is used by:

- **Scouting** — reported as ranges (e.g. "CA 55–62, PA 70–85"); better scouts give narrower ranges.
- **Contracts** — asking price and market value.
- **AI general managers** — trade and draft valuation.
- **Development** — growth slows as CA approaches PA.

**Potential can shift over a career** (tentative). Small drift driven by Work Ethic, Professionalism, and injuries allows late bloomers and busts. Keep the drift small so PA stays meaningful for scouting.

## Tendencies

For now, how often a player shoots threes, drives, or posts up is **derived from attributes plus coach instructions**. Explicit tendency sliders (3PA rate, drive rate, post-up rate) may be added when tactics are implemented.

## Positions

Positions are **not stored**. The game computes a 1–20 rating for each of the five positions (PG, SG, SF, PF, C) from attributes and measurables, and from that a role label (e.g. "Stretch Big", "3-and-D Wing"). See [player-roles.md](player-roles.md).
