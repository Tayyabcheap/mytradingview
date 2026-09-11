#!/usr/bin/env python3
"""
Haider-Gold-Scalper [SL Buffer] CLI Backtester.
Runs backtest simulations against real MT5 broker history or CSV data.

Usage:
    python tools/backtest_haider_gold_scalper.py --symbol XAUUSDc --tf 1H --bars 3000
"""
import sys
from pathlib import Path

# Add directory to sys.path so it can find backtest_real_dip
sys.path.insert(0, str(Path(__file__).parent))
from backtest_real_dip import main

if __name__ == "__main__":
    main()
