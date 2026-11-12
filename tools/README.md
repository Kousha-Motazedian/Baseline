# tools

Dev scripts, e.g. batch-simulating seasons for balance checks.

- `sim-game.ts` (`npm run sim:game -- [seed]`): one game between two generated teams; box scores and the last plays.
- `batch-sim.ts` (`npm run sim:batch -- [--games N] [--seed S] [--balance]`): league averages vs. real pro-league targets, FGA mix by play type, and offense/defense balance tests.
