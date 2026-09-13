"""
Unit tests for Autonomous Scalper Bot Daemon and API endpoints.
"""

import unittest
import json
import os
import sys

# Ensure src is on sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "src"))

from scalper_bot import ScalperBot, get_scalper_bot
from app import app


class TestScalperBot(unittest.TestCase):
    def setUp(self):
        self.bot = ScalperBot()

    def test_initial_state(self):
        status = self.bot.status()
        self.assertIn("is_running", status)
        self.assertIn("enabled", status)
        self.assertIn("strategy", status)
        self.assertIn("lot_size", status)
        self.assertEqual(status["strategy"], "HAIDER_ENHANCED")
        self.assertLessEqual(status["lot_size"], 1.0)

    def test_gold_safety_lot_cap(self):
        """User safety rule: lot size on Gold must strictly be <= 1.0."""
        # Attempt to set 2.5 lots
        res = self.bot.configure(lot_size=2.5)
        self.assertLessEqual(res["lot_size"], 1.0)
        self.assertEqual(res["lot_size"], 1.0)

        # Setting safe lot 0.10 works
        res = self.bot.configure(lot_size=0.10)
        self.assertEqual(res["lot_size"], 0.10)

    def test_configuration_toggle(self):
        res = self.bot.configure(enabled=True, strategy="REAL_DIP")
        self.assertTrue(res["enabled"])
        self.assertEqual(res["strategy"], "REAL_DIP")

        res = self.bot.configure(enabled=False, strategy="HAIDER_ENHANCED")
        self.assertFalse(res["enabled"])
        self.assertEqual(res["strategy"], "HAIDER_ENHANCED")

    def test_tranche_volume_split(self):
        """Verify 2-tranche split for 0.10 standard lot."""
        total_lot = 0.10
        tranche_1 = round(total_lot * 0.5, 2)
        tranche_2 = round(total_lot - tranche_1, 2)
        self.assertEqual(tranche_1, 0.05)
        self.assertEqual(tranche_2, 0.05)
        self.assertEqual(tranche_1 + tranche_2, 0.10)

    def test_api_status_endpoint(self):
        client = app.test_client()
        res = client.get("/api/scalper/bot/status")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("is_running", data)
        self.assertIn("strategy", data)
        self.assertIn("max_gold_lot", data)
        self.assertEqual(data["max_gold_lot"], 1.0)

    def test_api_toggle_endpoint(self):
        client = app.test_client()
        res = client.post("/api/scalper/bot/toggle", json={
            "enabled": True,
            "strategy": "HAIDER_ENHANCED",
            "lot_size": 0.15
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["enabled"])
        self.assertEqual(data["strategy"], "HAIDER_ENHANCED")
    def test_multi_symbol_configuration(self):
        """Default is Gold only; user can configure up to 10 instruments."""
        status = self.bot.status()
        self.assertIn("symbols", status)
        self.assertIn("XAUUSDc", status["symbols"])
        self.assertEqual(status["max_instruments"], 10)

        # Configure 3 pairs
        configured = self.bot.configure(symbols=["XAUUSDc", "EURUSDc", "GBPUSDc"])
        self.assertEqual(len(configured["symbols"]), 3)
        self.assertIn("EURUSDc", configured["symbols"])

        # Attempt to configure 12 pairs - must be clamped strictly to 10
        too_many = [f"PAIR{i}" for i in range(12)]
        clamped = self.bot.configure(symbols=too_many)
        self.assertEqual(len(clamped["symbols"]), 10)

    def test_api_symbols_endpoint(self):
        client = app.test_client()
        # GET symbols
        res = client.get("/api/scalper/bot/symbols")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("symbols", data)
        self.assertEqual(data["max_instruments"], 10)

        # POST update symbols
        post_res = client.post("/api/scalper/bot/symbols", json={
            "symbols": ["XAUUSDc", "USDJPYc", "AUDUSDc"]
        })
        self.assertEqual(post_res.status_code, 200)
        post_data = post_res.get_json()
        self.assertIn("symbols", post_data)
        self.assertEqual(len(post_data["symbols"]), 3)


if __name__ == "__main__":
    unittest.main()
