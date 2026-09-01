"""
Strategy and Signal Engine tests — tests the dual strategy signal gates (Swing Core & Swing Pro).
"""

import os
import sys
import unittest
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

import config
from indicators import prepare_dataframe
from signal_engine import SignalEngine, SWING_CORE, SWING_PRO


class TestStrategyGates(unittest.TestCase):
    def setUp(self):
        self.engine = SignalEngine()

    def test_engine_initialization(self):
        self.assertIsNotNone(self.engine)
        self.assertEqual(len(self.engine.sr_zones), 0)

    def test_bullish_swing_core_signal(self):
        # Generate 100 synthetic bars simulating an uptrend pullback and bullish engulfing
        times = pd.date_range("2026-08-01 00:00", periods=100, freq="1h")
        close_prices = np.linspace(2000, 2050, 100)
        
        df_ltf = pd.DataFrame({
            "time": times,
            "open": close_prices - 1.0,
            "high": close_prices + 2.0,
            "low": close_prices - 2.0,
            "close": close_prices,
            "tick_volume": 100
        })
        
        df_htf = pd.DataFrame({
            "time": pd.date_range("2026-08-01 00:00", periods=100, freq="1d"),
            "open": np.linspace(1950, 2000, 100),
            "high": np.linspace(1960, 2020, 100),
            "low": np.linspace(1940, 1990, 100),
            "close": np.linspace(1955, 2010, 100),
            "tick_volume": 1000
        })

        df_itf = pd.DataFrame({
            "time": pd.date_range("2026-08-01 00:00", periods=100, freq="4h"),
            "open": np.linspace(1980, 2020, 100),
            "high": np.linspace(1990, 2030, 100),
            "low": np.linspace(1970, 2010, 100),
            "close": np.linspace(1985, 2025, 100),
            "tick_volume": 500
        })

        df_prep = prepare_dataframe(df_ltf, df_itf, df_htf)
        self.assertIn("ema_50", df_prep.columns)
        self.assertIn("atr", df_prep.columns)
        self.assertIn("bullish_engulfing", df_prep.columns)

    def test_evaluate_bar_bounds_check(self):
        # Evaluation should safely return None when index is too small
        df = pd.DataFrame({
            "time": pd.date_range("2026-08-01", periods=10, freq="1h"),
            "close": [2000] * 10
        })
        sig = self.engine.evaluate_bar(df, idx=2)
        self.assertIsNone(sig)
        self.assertEqual(self.engine.last_reject, "Not enough bars to evaluate")


if __name__ == '__main__':
    unittest.main()
