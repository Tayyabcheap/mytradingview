"""
Unit tests for Haider-Gold-Scalper Trade Diagnostic & Post-Mortem Logging Engine.
"""

import unittest
import os
import sys
import tempfile
import shutil

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))

import scalper_logger


class TestScalperLoggerDiagnostics(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.original_data_dir = scalper_logger.DATA_DIR
        self.original_json_path = scalper_logger.AUDIT_JSON_PATH
        self.original_csv_path = scalper_logger.AUDIT_CSV_PATH

        scalper_logger.DATA_DIR = self.temp_dir
        scalper_logger.AUDIT_JSON_PATH = os.path.join(self.temp_dir, "haider_scalper_signals_audit.json")
        scalper_logger.AUDIT_CSV_PATH = os.path.join(self.temp_dir, "haider_scalper_signals_audit.csv")

    def tearDown(self):
        scalper_logger.DATA_DIR = self.original_data_dir
        scalper_logger.AUDIT_JSON_PATH = self.original_json_path
        scalper_logger.AUDIT_CSV_PATH = self.original_csv_path
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_buy_premature_sl_hunt_detected(self):
        # Buy trade at 2650, SL 2645, TP 2660
        trade = {
            "id": "HGS_TEST_1",
            "symbol": "XAUUSDc",
            "direction": "BUY",
            "entry_price": 2650.0,
            "planned_sl": 2645.0,
            "planned_tp1": 2660.0,
            "exit_price": 2645.0,
            "exit_reason": "SL_HIT",
            "pnl_usd": -50.0,
            "pnl_pips": -50.0
        }

        # Subsequent candles: price dips to 2644.4 (overshoot = 0.6 USD = 6.0 pips <= 12.0)
        # then rallies to 2662.0 (hitting what would have been TP1 at 2660.0)
        subsequent = [
            {"high": 2645.5, "low": 2644.4, "close": 2645.0},
            {"high": 2652.0, "low": 2646.0, "close": 2650.0},
            {"high": 2662.0, "low": 2655.0, "close": 2661.0},
        ]

        diag = scalper_logger.evaluate_post_mortem(trade, subsequent, sl_hunt_threshold_pips=12.0)

        self.assertTrue(diag["sl_hunt_detected"])
        self.assertEqual(diag["diagnosis_verdict"], "PREMATURE_SL_HUNT")
        self.assertEqual(diag["sl_overshoot_pips"], 6.0)
        self.assertIn("Premature Stop-Out", diag["actionable_coaching_note"])

    def test_buy_valid_stop_not_flagged_as_hunt(self):
        # Buy trade at 2650, SL 2645, TP 2660
        trade = {
            "id": "HGS_TEST_2",
            "symbol": "XAUUSDc",
            "direction": "BUY",
            "entry_price": 2650.0,
            "planned_sl": 2645.0,
            "planned_tp1": 2660.0,
            "exit_price": 2645.0,
            "exit_reason": "SL_HIT",
            "pnl_usd": -50.0
        }

        # Price keeps falling down to 2630.0 and never reaches TP
        subsequent = [
            {"high": 2644.0, "low": 2638.0, "close": 2639.0},
            {"high": 2639.0, "low": 2630.0, "close": 2632.0},
        ]

        diag = scalper_logger.evaluate_post_mortem(trade, subsequent)

        self.assertFalse(diag["sl_hunt_detected"])
        self.assertEqual(diag["diagnosis_verdict"], "VALID_INVALIDATION")
        self.assertIn("Protective Stop", diag["actionable_coaching_note"])

    def test_buy_runner_left_on_table(self):
        # Buy trade at 2650, TP1 at 2655 (50 pips)
        trade = {
            "id": "HGS_TEST_3",
            "symbol": "XAUUSDc",
            "direction": "BUY",
            "entry_price": 2650.0,
            "planned_sl": 2646.0,
            "planned_tp1": 2655.0,
            "exit_price": 2655.0,
            "exit_reason": "TP_HIT",
            "pnl_usd": 50.0
        }

        # Price explodes past TP up to 2690.0 (+350 pips past TP1)
        subsequent = [
            {"high": 2665.0, "low": 2654.0, "close": 2662.0},
            {"high": 2690.0, "low": 2660.0, "close": 2688.0},
        ]

        diag = scalper_logger.evaluate_post_mortem(trade, subsequent)

        self.assertTrue(diag["runner_left_on_table"])
        self.assertEqual(diag["diagnosis_verdict"], "RUNNER_LEFT_ON_TABLE")
        self.assertEqual(diag["money_left_on_table_pips"], 350.0)
        self.assertIn("Undersized Target", diag["actionable_coaching_note"])

    def test_sell_premature_sl_hunt(self):
        # Sell trade at 2650, SL 2655, TP 2640
        trade = {
            "id": "HGS_TEST_4",
            "symbol": "XAUUSDc",
            "direction": "SELL",
            "entry_price": 2650.0,
            "planned_sl": 2655.0,
            "planned_tp1": 2640.0,
            "exit_price": 2655.0,
            "exit_reason": "SL_HIT",
            "pnl_usd": -50.0
        }

        # High spikes to 2655.8 (0.8 USD overshoot = 8.0 pips), then drops to 2638.0
        subsequent = [
            {"high": 2655.8, "low": 2652.0, "close": 2653.0},
            {"high": 2650.0, "low": 2638.0, "close": 2639.0},
        ]

        diag = scalper_logger.evaluate_post_mortem(trade, subsequent, sl_hunt_threshold_pips=12.0)

        self.assertTrue(diag["sl_hunt_detected"])
        self.assertEqual(diag["diagnosis_verdict"], "PREMATURE_SL_HUNT")
        self.assertEqual(diag["sl_overshoot_pips"], 8.0)

    def test_upsert_and_weekly_report(self):
        # 1 Win, 1 SL Hunt, 1 Valid Loss
        trade1 = {
            "id": "T1",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "direction": "BUY",
            "pnl_usd": 100.0,
            "pnl_pips": 100.0,
            "exit_reason": "TP_HIT",
            "status": "CLOSED",
            "entry_time": 1700000000,
            "post_exit_analysis": {
                "diagnosis_verdict": "CLEAN_WIN",
                "sl_hunt_detected": False
            }
        }
        trade2 = {
            "id": "T2",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "direction": "BUY",
            "pnl_usd": -50.0,
            "pnl_pips": -50.0,
            "exit_reason": "SL_HIT",
            "status": "CLOSED",
            "entry_time": 1700000100,
            "post_exit_analysis": {
                "diagnosis_verdict": "PREMATURE_SL_HUNT",
                "sl_hunt_detected": True,
                "sl_overshoot_pips": 5.5
            }
        }
        trade3 = {
            "id": "T3",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "direction": "SELL",
            "pnl_usd": -50.0,
            "pnl_pips": -50.0,
            "exit_reason": "SL_HIT",
            "status": "CLOSED",
            "entry_time": 1700000200,
            "post_exit_analysis": {
                "diagnosis_verdict": "VALID_INVALIDATION",
                "sl_hunt_detected": False
            }
        }

        scalper_logger.upsert_trade(trade1)
        scalper_logger.upsert_trade(trade2)
        scalper_logger.upsert_trade(trade3)

        trades = scalper_logger.load_audit_trades()
        self.assertEqual(len(trades), 3)

        report = scalper_logger.generate_weekly_scalper_report(days=365)
        self.assertEqual(report["sample_size"], 3)
        self.assertEqual(report["wins"], 1)
        self.assertEqual(report["losses"], 2)
        self.assertEqual(report["win_rate"], 33.3)
        self.assertEqual(report["sl_hunt_count"], 1)
        # Recoverable win rate = (1 win + 1 sl_hunt) / 3 = 66.7%
        self.assertEqual(report["recoverable_win_rate"], 66.7)
        self.assertGreater(len(report["recommendations"]), 0)


if __name__ == "__main__":
    unittest.main()
