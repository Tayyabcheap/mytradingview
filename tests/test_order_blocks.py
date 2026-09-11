"""
Unit tests for Dual-Timeframe Order Block Engine (Smart Money Concepts).
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

from intelligence import calculate_order_blocks, find_order_block_confluences

class TestOrderBlockEngine(unittest.TestCase):
    def setUp(self):
        # Create a series with a clear bullish order block (bearish candle followed by explosive breakout)
        self.candles = []
        base = 2650.0
        for i in range(15):
            self.candles.append({
                "timestamp": 1000 + i * 300000,
                "open": base,
                "high": base + 1.0,
                "low": base - 1.0,
                "close": base + 0.1,
                "volume": 100
            })
            base += 0.1

        # Bearish candle that becomes Bullish Order Block (Demand)
        self.candles.append({
            "timestamp": 1000 + 15 * 300000,
            "open": 2651.5,
            "high": 2652.0,
            "low": 2649.0,
            "close": 2650.0,
            "volume": 150
        })

        # Aggressive bullish displacement candle breaking above prior high
        self.candles.append({
            "timestamp": 1000 + 16 * 300000,
            "open": 2650.5,
            "high": 2658.0,
            "low": 2650.0,
            "close": 2657.0,
            "volume": 600
        })

        # Continued trend
        base = 2657.0
        for i in range(17, 35):
            self.candles.append({
                "timestamp": 1000 + i * 300000,
                "open": base,
                "high": base + 1.5,
                "low": base - 0.5,
                "close": base + 1.0,
                "volume": 200
            })
            base += 1.0

    def test_calculate_order_blocks_detects_demand(self):
        res = calculate_order_blocks(self.candles, timeframe="5M", current_price=2675.0)
        self.assertEqual(res["timeframe"], "5M")
        self.assertGreaterEqual(len(res["bullish"]), 1)

        demand = res["bullish"][0]
        self.assertEqual(demand["type"], "BULL")
        self.assertEqual(demand["top"], 2652.0)
        self.assertEqual(demand["bottom"], 2649.0)
        self.assertEqual(demand["mid"], 2650.5)
        self.assertEqual(demand["status"], "UNMITIGATED")
        self.assertGreater(demand["distance_usd"], 0)

    def test_order_block_confluence_detection(self):
        ob_5m = {
            "timeframe": "5M",
            "all_zones": [{
                "type": "BULL",
                "kind": "Demand",
                "top": 2652.0,
                "bottom": 2649.0,
                "status": "UNMITIGATED"
            }]
        }
        ob_15m = {
            "timeframe": "15M",
            "all_zones": [{
                "type": "BULL",
                "kind": "Demand",
                "top": 2655.0,
                "bottom": 2648.0,
                "status": "UNMITIGATED"
            }]
        }

        confluences = find_order_block_confluences(ob_5m, ob_15m)
        self.assertEqual(len(confluences), 1)
        conf = confluences[0]
        self.assertEqual(conf["type"], "BULL")
        self.assertIn("A+ Institutional Confluence", conf["quality"])
        self.assertEqual(conf["confluence_range"], "2649.0 - 2652.0")

if __name__ == '__main__':
    unittest.main()
