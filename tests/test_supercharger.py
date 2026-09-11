import unittest
import numpy as np
from src.stress_test import run_monte_carlo_simulation
from src.screener import _calc_rsi, _calc_ema, _calc_atr
from src.notifications import get_discord_config, save_discord_config


class TestSuperchargerFeatures(unittest.TestCase):

    def test_monte_carlo_simulation_structure(self):
        res = run_monte_carlo_simulation(
            initial_balance=10000.0,
            simulations=200,
            num_trades=40,
            win_rate=65.0,
            reward_risk=1.5,
            lot_size=0.10,
            ruin_threshold_pct=20.0
        )
        self.assertTrue(res["success"])
        self.assertIn("curves", res)
        self.assertIn("stats", res)
        self.assertIn("histogram", res)

        stats = res["stats"]
        self.assertIn("risk_of_ruin_pct", stats)
        self.assertIn("dd_95", stats)
        self.assertIn("mcl_95", stats)
        self.assertIn("grade", stats)
        self.assertIn("recommended_lot", stats)

        curves = res["curves"]
        self.assertEqual(len(curves["p95"]), 41)
        self.assertEqual(len(curves["p50"]), 41)
        self.assertEqual(len(curves["p05"]), 41)
        self.assertGreaterEqual(curves["p95"][-1], curves["p05"][-1])

    def test_screener_math_helpers(self):
        closes = np.array([100.0, 101.0, 102.0, 101.5, 103.0, 104.0, 103.5, 105.0, 106.0, 105.5, 107.0, 108.0, 107.5, 109.0, 110.0, 111.0])
        highs = closes + 0.5
        lows = closes - 0.5

        rsi = _calc_rsi(closes, length=5)
        self.assertEqual(len(rsi), len(closes))
        self.assertGreater(rsi[-1], 50.0)

        ema = _calc_ema(closes, length=5)
        self.assertEqual(len(ema), len(closes))
        self.assertAlmostEqual(ema[0], closes[0])

        atr = _calc_atr(highs, lows, closes, length=5)
        self.assertEqual(len(atr), len(closes))
        self.assertGreater(atr[-1], 0.0)

    def test_discord_config_io(self):
        cfg = get_discord_config()
        self.assertIsInstance(cfg, dict)
        self.assertIn("discord_enabled", cfg)

        updated = save_discord_config({
            "discord_webhook_url": "https://discord.com/api/webhooks/test/123",
            "discord_enabled": True,
            "notify_on_signals": True,
            "notify_on_trades": True,
            "notify_on_auto_be": True,
        })
        self.assertTrue(updated["discord_enabled"])
        # Restore empty default
        save_discord_config(cfg)


if __name__ == "__main__":
    unittest.main()
