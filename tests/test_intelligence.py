"""
Unit tests for the Intelligence Engine (Hurst exponent, Kelly criterion, Price predictor cone, Champions council).
"""

import unittest
import math
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

from intelligence import (
    calculate_hurst_exponent,
    calculate_kelly_criterion,
    calculate_zscore,
    calculate_price_projections,
    get_champions_council_verdict,
    get_macro_sentinel_status,
    get_gold_liquidity_fixes
)

class TestIntelligenceEngine(unittest.TestCase):
    def test_hurst_exponent_trending_series(self):
        # Synthetic upward persistent trend
        prices = [100.0 + i * 1.5 + (0.1 * math.sin(i)) for i in range(80)]
        res = calculate_hurst_exponent(prices)
        self.assertIn("hurst", res)
        self.assertIn("regime", res)
        self.assertGreaterEqual(res["hurst"], 0.50)

    def test_hurst_exponent_short_series(self):
        prices = [100.0, 101.0, 100.5]
        res = calculate_hurst_exponent(prices)
        self.assertEqual(res["hurst"], 0.50)

    def test_kelly_criterion(self):
        res = calculate_kelly_criterion(win_rate_pct=68.4, reward_to_risk=1.5)
        self.assertTrue(res["is_positive_expectancy"])
        self.assertGreater(res["full_kelly_pct"], 0)
        self.assertGreater(res["quarter_kelly_pct"], 0)
        self.assertLessEqual(res["quarter_kelly_pct"], res["half_kelly_pct"])

    def test_price_projections_and_fvgs(self):
        candles = []
        base = 2500.0
        for i in range(50):
            candles.append({
                "open": base,
                "high": base + 2.0,
                "low": base - 2.0,
                "close": base + 0.5,
                "timestamp": 1000 + i * 300
            })
            base += 0.5

        res = calculate_price_projections(candles, current_price=base)
        self.assertIn("p80_high", res)
        self.assertIn("p80_low", res)
        self.assertIn("p95_high", res)
        self.assertIn("p95_low", res)
        self.assertGreater(res["p95_high"], res["p80_high"])
        self.assertLess(res["p95_low"], res["p80_low"])

    def test_champions_council(self):
        candles = [{"close": 2000.0 + i, "open": 1999.0 + i, "high": 2002.0 + i, "low": 1998.0 + i} for i in range(30)]
        res = get_champions_council_verdict(candles, symbol="XAUUSDc", timeframe="5M")
        self.assertIn("consensus", res)
        self.assertEqual(len(res["champions"]), 3)

    def test_macro_and_fixes(self):
        macro = get_macro_sentinel_status("XAUUSDc")
        self.assertIn("macro_regime", macro)
        self.assertIn("red_folder_events", macro)

        fixes = get_gold_liquidity_fixes()
        self.assertIn("fixes", fixes)
        self.assertEqual(len(fixes["fixes"]), 3)

if __name__ == '__main__':
    unittest.main()
