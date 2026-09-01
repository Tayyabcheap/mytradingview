"""
Support and resistance zones detection tests.
"""

import os
import sys
import unittest
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

import config
from indicators import detect_sr_zones, find_pivots, nearest_sr


def ranging(low=4600.0, high=4660.0, cycles=5, seed=3):
    rng = np.random.default_rng(seed)
    seg = []
    for _ in range(cycles):
        seg += list(np.linspace(low, high, 60)) + list(np.linspace(high, low, 60))
    px = np.array(seg) + rng.normal(0, 1.2, len(seg))
    op = np.r_[px[0], px[:-1]]
    return pd.DataFrame({
        "time": pd.date_range("2026-06-01", periods=len(px), freq="1h"),
        "open": op,
        "high": np.maximum(op, px) + np.abs(rng.normal(0, .8, len(px))),
        "low": np.minimum(op, px) - np.abs(rng.normal(0, .8, len(px))),
        "close": px,
    })


class TestSRZones(unittest.TestCase):
    def setUp(self):
        self.df = ranging()

    def test_zones_found(self):
        zones = detect_sr_zones(self.df, price=float(self.df.close.iloc[-1]))
        self.assertGreater(len(zones), 0)

    def test_find_pivots(self):
        piv = find_pivots(self.df, config.SR_PIVOT_LEFT, config.SR_PIVOT_RIGHT)
        self.assertIsInstance(piv, list)
        self.assertGreater(len(piv), 0)

    def test_nearest_sr(self):
        zones = detect_sr_zones(self.df, price=float(self.df.close.iloc[-1]))
        if zones:
            near_above = nearest_sr(zones, price=4600.0, side="above")
            self.assertTrue(near_above is None or near_above["bottom"] >= 4600.0)


if __name__ == '__main__':
    unittest.main()
