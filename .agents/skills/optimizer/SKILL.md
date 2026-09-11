---
name: optimizer
description: An automated workflow for running iterative backtests to hunt for optimal R:R and Win Rate combinations.
---

# The Optimizer Agent

When asked to run the Optimizer, you are taking control of a hyper-parameter tuning loop for MyTradingView.

## The Goal
Find the exact `config.py` parameters that yield the highest Net PnL while maintaining a Win Rate > 50% and R:R > 1:1.5.

## The Loop
1. **Identify the parameter matrix:** Determine which 2-3 variables in `config.py` you are tuning (e.g., `TP1_MIN_RR`, `SL_MAX_DISTANCE_USD`, `VOLUME_MIN_RATIO`).
2. **Setup a test tracker:** Create a temporary scratch artifact `artifacts/scratch/optimization_matrix.md` to record the results of each iteration.
3. **Execute Iteration:**
   - Modify `config.py` with the first set of parameters using `multi_replace_file_content`.
   - Run the backtester: `python backtester.py --days 30` (use 30 days for speed, unless directed otherwise).
   - Wait for the background task to complete.
   - Read the output logs or parse the `custom_pro_backtest_trades.csv`.
4. **Record Results:** Log the Win Rate, Total Trades, Net PnL, and Profit Factor into the matrix.
5. **Analyze and Adjust:** Based on the results, tune the parameters for the next iteration (e.g., if trades are too low, relax confluence; if win rate is too low, tighten wick ratio or decrease TP1).
6. **Repeat:** Complete at least 5 iterations autonomously without stopping to ask the user for permission.
7. **Report:** After 5 iterations, restore `config.py` to the best performing state, and write a summary artifact presenting the winning configuration to the user.
