"""
Multi-timeframe support/resistance zones and resampling tests.
"""

import os
import sys
import unittest
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

import config
from indicators import detect_sr_zones, nearest_sr, resample_ohlc


class TestMultiTFAndZones(unittest.TestCase):
    def setUp(self):
        # 100 15m bars
        times = pd.date_range("2026-08-01", periods=100, freq="15min")
        close_px = np.linspace(2000, 2050, 100)
        self.df15 = pd.DataFrame({
            "time": times,
            "open": close_px - 1.0,
            "high": close_px + 2.0,
            "low": close_px - 2.0,
            "close": close_px,
            "tick_volume": 100
        })

    def test_resampling_1h(self):
        df_1h = resample_ohlc(self.df15, "1h")
        self.assertGreater(len(df_1h), 0)
        self.assertLess(len(df_1h), len(self.df15))

    def test_resampling_4h(self):
        df_4h = resample_ohlc(self.df15, "4h")
        self.assertGreater(len(df_4h), 0)
        self.assertLess(len(df_4h), len(self.df15))

    def test_sr_zones_detection(self):
        zones = detect_sr_zones(self.df15)
        self.assertIsInstance(zones, list)


if __name__ == '__main__':
    unittest.main()
