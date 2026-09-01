---
name: log_analyzer
description: A deep-dive statistical analysis tool for processing trade logs and extracting MFE/MAE edge cases.
---

# Trade Log Analyzer

When asked to "analyze the trade logs", you are acting as a quant researcher looking for hidden mathematical edges in the strategy's past performance.

## Execution Steps
1. **Locate Data:** Ensure `custom_pro_backtest_trades.csv` exists in the workspace. If not, instruct the user to run the backtester first, or run it yourself.
2. **Execute Python Script:** Write and execute a temporary Python script (`artifacts/scratch/analyze.py`) that reads the CSV using pandas.
3. **Analyze MFE/MAE:**
   - Group trades by `exit_reason`.
   - For all trades that hit `Hard SL Hit` or `CTC Breakeven Exit`, calculate the **Average MFE (Maximum Favorable Excursion)** in pips. This tells us exactly how far trades went into profit before reversing.
   - For all trades that hit `TP1 Reached` or `TP2 Reached`, calculate the **Average MAE (Maximum Adverse Excursion)** in pips. This tells us how much heat (drawdown) the trade took before winning.
4. **Identify Rejection Patterns:**
   - Parse the backtest `task-xxx.log` (if available) to extract the "Most common reasons a setup was declined".
   - Calculate what percentage of total signals were blocked by the `VOLUME` filter vs the `WICK` filter.
5. **Report:** Create an artifact `trade_analysis_report.md` presenting your findings. 
   - **Crucial Output:** If the average MFE of losing trades is +40 pips, you must strongly recommend lowering the TP1 target to 35 pips to capture those wins.
