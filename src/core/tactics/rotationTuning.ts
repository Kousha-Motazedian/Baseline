/**
 * Tuning data for rotations (docs/design/rotations.md). Ratings are on the 1-20 scale, minutes
 * are real minutes of a 48-minute game and are scaled to the league's rules at use.
 */

// --- Plan: how the coach rates players -------------------------------------------------------

/** Reputation's share of perceived value at Player Evaluation 1 and 20 (design decision 3), linear between. */
export const REPUTATION_SHARE_AT_PE_1 = 0.7
export const REPUTATION_SHARE_AT_PE_20 = 0.1
/** Rating points that system fit (-1..+1) adds to real value: a perfect fit is worth a decent upgrade. */
export const FIT_RATING_POINTS = 2
/** Rating points of perceived value a Works With Youth of 1 / 20 takes from / gives to players aged <= YOUTH_MAX_AGE. */
export const YOUTH_RATING_POINTS = 2
export const YOUTH_MAX_AGE = 23
/** Closers lean on real value: their Player Evaluation blend shifts this far toward real value. */
export const CLOSER_REAL_SHIFT = 0.15

// --- Plan: lineup search ---------------------------------------------------------------------

/** Only the top few players by perceived value are considered for a five (keeps the search tiny). */
export const LINEUP_CANDIDATES = 8
/** Rating points lost per point a player rates below his best position at the slot he fills. */
export const SLOT_MISFIT_WEIGHT = 1
/** Flat cost of putting a player in a slot his height rules out (still allowed when nothing else exists). */
export const INELIGIBLE_SLOT_COST = 8

// --- Plan: minutes ---------------------------------------------------------------------------

/** Players with real minutes, by Rotation depth. */
export const ROTATION_SIZE = { tight: 8, normal: 9, deep: 10 } as const
/** Average starter minutes (of 48), by Starter minutes. */
export const STARTER_MINUTES = { rideStarters: 40, balanced: 37, share: 34 } as const
/** Minutes a starter gains/loses per rating point of perceived value above/below the starters' average, capped. */
export const STARTER_SPREAD_PER_POINT = 0.6
export const STARTER_SPREAD_CAP = 3
/** Each next bench player (by perceived value) gets this share of the previous one's minutes. */
export const BENCH_DECAY = 0.75
/** Real game length the minute constants are written for. */
export const REFERENCE_GAME_MINUTES = 48

// --- In-game: utility of a player being on the floor ----------------------------------------

/** Utility cost per rotation-order step (breaks ties by the plan's priority). */
export const RANK_WEIGHT = 0.25
/** Utility per minute a player is behind his planned pace, at Rotation Management 1 and 20. */
export const PACE_WEIGHT_AT_RM_1 = 0.35
export const PACE_WEIGHT_AT_RM_20 = 1
/** Utility penalty for a player the plan leaves out of the rotation (target 0). */
export const OUT_OF_ROTATION_COST = 3
/** Bonus a player already on the floor has over an equal one on the bench: the anti-churn hysteresis. */
export const INCUMBENT_BONUS = 2.5
/** Fatigue starts to cost utility below this energy, at Rotation Management 1 and 20 (high = sub early). */
export const TIRED_LINE_AT_RM_1 = 30
export const TIRED_LINE_AT_RM_20 = 60
/** Utility lost per energy point below the tired line. */
export const FATIGUE_WEIGHT = 0.4
/** Chance per dead ball that the coach even looks at voluntary subs, at RM 1 and 20 (low reacts late). */
export const ATTENTION_AT_RM_1 = 0.5
export const ATTENTION_AT_RM_20 = 1
/** Most voluntary substitutions in one call (real subs come in waves of one or two). */
export const MAX_NORMAL_SUBS = 2

// --- In-game: foul trouble -------------------------------------------------------------------

/** The personal-foul limit the 2/3/4/5-by-quarter table is written for (pro); scaled for other limits. */
export const FOUL_TABLE_LIMIT = 6
/** Never sit a player for fewer fouls than this. */
export const FOUL_TROUBLE_MIN_FOULS = 2
/** Share of the period left at which a sitter may come back, at Game Management 1 and 20. */
export const FOUL_RETURN_SHARE_AT_GM_1 = 0.1
export const FOUL_RETURN_SHARE_AT_GM_20 = 0.45
/** Game Management at or below / above which top players are sat one foul earlier / later. */
export const GM_CAUTIOUS = 6
export const GM_GAMBLER = 15
/** Rotation-order positions below this count as "stars" for the Game Management foul tweak. */
export const STAR_RANK = 5

// --- In-game: close games and garbage time ---------------------------------------------------

/** The last this-many seconds of the final period (and overtime) count as the finish. */
export const CLOSE_WINDOW_SECONDS = 300
/** Window multiplier at Game Management 1 and 20 (a sharper coach goes to his closers sooner). */
export const CLOSE_WINDOW_FACTOR_AT_GM_1 = 0.75
export const CLOSE_WINDOW_FACTOR_AT_GM_20 = 1.25
/** A game is close for closers/fouls when the margin is at most this many points... */
export const CLOSE_LEAD_POINTS = 8
/** ...and the lead is under this many remaining-swing SDs. */
export const CLOSE_SAFETY = 1.5
/** Utility bonus for a closer in the finish, and the energy below which it is withdrawn. */
export const CLOSER_BONUS = 6
export const CLOSER_MIN_ENERGY = 25
/** Garbage time: the second half, a lead this big and this safe (SDs; Game Management 1 / 20). */
export const GARBAGE_LEAD_POINTS = 12
export const GARBAGE_SAFETY_AT_GM_1 = 2
export const GARBAGE_SAFETY_AT_GM_20 = 1.2
/** The trailing coach needs this many times the leader's lead and safety before he gives up. */
export const GARBAGE_TRAILING_FACTOR = 1.17
/** Utility per rotation-order step in garbage time (deepest first). */
export const GARBAGE_RANK_WEIGHT = 1
/** Utility penalty that rules a player out (disqualified, on the floor, or sitting with fouls). */
export const INELIGIBLE_UTILITY = -1000
