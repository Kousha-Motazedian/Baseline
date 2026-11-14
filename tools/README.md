# tools

Dev scripts, e.g. batch-simulating seasons for balance checks.

- `sim-game.ts` (`npm run sim:game -- [seed]`): one game between two generated teams; box scores and the last plays.
- `batch-sim.ts` (`npm run sim:batch -- [--games N] [--seed S] [--balance] [--balance-games N] [--average]`): league averages vs. real pro-league targets (incl. fouls, technicals, foul-outs per game, fast-break points), individual box-score watch numbers (team top scorer, 40+/50+ games; report only), FGA mix by play type, identical-team randomness (margin SD, overtime rate, home edge), and offense/defense balance tests. Teams are realistic league teams by default; `--average` uses uniform, star-free average teams instead.
- `inspect-league.ts` (`npm run inspect:league -- [--seed S] [--leagues N]`): one generated 30-team league: players per CA tier (with mean attribute and two-role count), primary positions, roles held, and the top 15 players. With `--leagues N`, also the mean tier counts, GOATs-per-league frequency and the share of superstars with two roles over N leagues. Use it to check the CA calibration in `docs/design/player-roles.md`.
