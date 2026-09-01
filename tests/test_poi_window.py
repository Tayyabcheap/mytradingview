"""
POI window and swing low / swing high indicator tests.
"""

import os
import sys
import unittest
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

import config
from indicators import (
    recent_swing_high,
    recent_swing_low,
    calculate_atr,
    calculate_ema,
    calculate_rsi,
    calculate_macd
)


class TestPOIWindowAndIndicators(unittest.TestCase):
    def setUp(self):
        times = pd.date_range("2026-08-01", periods=100, freq="1h")
        close_px = np.sin(np.linspace(0, 10, 100)) * 20 + 2000
        self.df = pd.DataFrame({
            "time": times,
            "open": close_px - 0.5,
            "high": close_px + 2.0,
            "low": close_px - 2.0,
            "close": close_px,
            "tick_volume": 100
        })

    def test_calculate_atr(self):
        atr = calculate_atr(self.df, period=14)
        self.assertEqual(len(atr), 100)
        self.assertFalse(atr.isna().all())

    def test_calculate_ema(self):
        ema = calculate_ema(self.df["close"], period=20)
        self.assertEqual(len(ema), 100)
        self.assertFalse(ema.isna().all())

    def test_calculate_rsi(self):
        rsi = calculate_rsi(self.df, period=14)
        self.assertEqual(len(rsi), 100)
        valid_rsi = rsi.dropna()
        self.assertTrue((valid_rsi >= 0).all() and (valid_rsi <= 100).all())

    def test_calculate_macd(self):
        macd, signal, hist = calculate_macd(self.df)
        self.assertEqual(len(macd), 100)
        self.assertEqual(len(signal), 100)
        self.assertEqual(len(hist), 100)


if __name__ == '__main__':
    unittest.main()
