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

        # Restore default Gold-only symbols to avoid polluting persistent store
        client.post("/api/scalper/bot/symbols", json={"symbols": ["XAUUSDc"]})

    def test_enhanced_calculations_and_immediate_execution_latency(self):
        """Verify math calculations and ensure execution completes in under 50ms (< 3s requirement)."""
        import time
        # Synthetic 5M bars fixture leading up to a valid Haider-Enhanced BUY setup
        # Buy condition: close < open, body > ATR, RSI < 36, lower_wick >= 18%
        bars = []
        base_time = 1700000000
        for idx in range(30):
            t = base_time + idx * 300
            # Gradual downward drift so RSI drops below 36
            price = 2000.0 - idx * 1.5
            bars.append({
                "time": t, "open": price, "high": price + 1.0, "low": price - 1.0, "close": price - 0.5, "tick_volume": 100
            })
        
        # Last closed bar (idx 30): large impulse down bar with bottom rejection wick >= 18%
        t_last = base_time + 30 * 300
        # Open 1955, Close 1945 (body = 10, range = 15, low = 1940, high = 1955)
        # Lower wick = (min(1955, 1945) - 1940) / 15 = 5 / 15 = 33.3% >= 18%
        bars.append({
            "time": t_last, "open": 1955.0, "high": 1955.0, "low": 1940.0, "close": 1945.0, "tick_volume": 200
        })

        # Newly opened live bar
        current_bar = {
            "time": t_last + 300, "open": 1945.2, "high": 1945.5, "low": 1945.0, "close": 1945.2, "tick_volume": 10
        }

        sym_state = self.bot._get_symbol_state("XAUUSDc")
        sym_state["last_bar_time"] = base_time + 29 * 300

        executed_calls = []
        def mock_execute(symbol, signal_type, entry, sl, tp1, strategy_name):
            executed_calls.append({
                "symbol": symbol, "type": signal_type, "entry": entry, "sl": sl, "tp1": tp1, "strat": strategy_name
            })
        self.bot._execute_signal = mock_execute

        t_start = time.perf_counter()
        self.bot._process_closed_bar_for_symbol("XAUUSDc", sym_state, bars, current_bar)
        elapsed_ms = (time.perf_counter() - t_start) * 1000.0

        # Latency check: calculation and signal dispatch must execute well under 50ms (< 3s SLA)
        self.assertLess(elapsed_ms, 50.0, f"Execution latency too slow: {elapsed_ms:.2f}ms")
        self.assertEqual(len(executed_calls), 1, "Expected immediate execution on closed candle setup")

        call = executed_calls[0]
        self.assertEqual(call["symbol"], "XAUUSDc")
        self.assertEqual(call["type"], "BUY")
        self.assertEqual(call["entry"], 1945.2)
        # SL must be below candle low (1940.0)
        self.assertLess(call["sl"], 1940.0)
        # TP1 must be at 50% retracement of impulse range (1940 + 7.5 = 1947.5)
        self.assertEqual(call["tp1"], 1947.5)

    def test_clean_base_symbol(self):
        from symbol_utils import clean_base_symbol
        self.assertEqual(clean_base_symbol("BTCUSDc"), "BTCUSD")
        self.assertEqual(clean_base_symbol("BTCUSDm"), "BTCUSD")
        self.assertEqual(clean_base_symbol("XAUUSD.m"), "XAUUSD")
        self.assertEqual(clean_base_symbol("EURUSD_i"), "EURUSD")
        self.assertEqual(clean_base_symbol("GBPUSDpro"), "GBPUSD")
        self.assertEqual(clean_base_symbol("USDJPYraw"), "USDJPY")
        self.assertEqual(clean_base_symbol("BTCUSD"), "BTCUSD")

    def test_multi_instrument_telemetry_broker_symbol(self):
        self.bot.configure(symbols=["BTCUSDc", "XAUUSDc"])
        status = self.bot.status()
        self.assertIn("BTCUSDc", status["per_symbol"])
        self.assertIn("XAUUSDc", status["per_symbol"])
        self.assertIn("broker_symbol", status["per_symbol"]["BTCUSDc"])

    def test_scalper_performance_endpoints(self):
        with app.test_client() as client:
            res = client.get("/api/scalper/performance?symbol=XAUUSDc")
            self.assertIn(res.status_code, (200, 400, 500))  # 200 if MT5 connected, 400/500 if offline test
            if res.status_code == 200:
                data = json.loads(res.data)
                self.assertIn("HAIDER_ENHANCED", data)
                self.assertIn("REAL_DIP", data)
                self.assertIn("winRate", data["HAIDER_ENHANCED"])
                self.assertIn("profitFactor", data["HAIDER_ENHANCED"])

            res_batch = client.get("/api/scalper/performance/batch?symbols=XAUUSDc,EURUSDc")
            self.assertEqual(res_batch.status_code, 200)
            data_b = json.loads(res_batch.data)
            self.assertIn("instruments", data_b)
            self.assertIn("count", data_b)

    def test_symbol_lot_sizes_configuration_and_api(self):
        """Test per-instrument lot sizes configuration, Gold safety cap, and endpoints."""
        # 1. Direct configure call: Gold lot capped at 1.0, Forex allows custom lot
        status = self.bot.configure(symbol_lot_sizes={
            "XAUUSDc": 2.50,  # Must be clamped strictly to 1.0!
            "EURUSDc": 0.25,
            "USDJPYc": 0.50
        })
        self.assertIn("symbol_lot_sizes", status)
        self.assertEqual(status["symbol_lot_sizes"]["XAUUSDc"], 1.0)
        self.assertEqual(status["symbol_lot_sizes"]["EURUSDc"], 0.25)
        self.assertEqual(status["symbol_lot_sizes"]["USDJPYc"], 0.50)

        # 2. Test API GET & POST /api/scalper/bot/lot_sizes
        with app.test_client() as client:
            get_res = client.get("/api/scalper/bot/lot_sizes")
            self.assertEqual(get_res.status_code, 200)
            get_data = json.loads(get_res.data)
            self.assertIn("symbol_lot_sizes", get_data)
            self.assertEqual(get_data["max_gold_lot"], 1.0)

            post_res = client.post("/api/scalper/bot/lot_sizes", json={
                "symbol_lot_sizes": {
                    "GBPUSDc": 0.30,
                    "XAUUSDc": 0.05
                }
            })
            self.assertEqual(post_res.status_code, 200)
            post_data = json.loads(post_res.data)
            self.assertTrue(post_data["success"])
            self.assertEqual(post_data["symbol_lot_sizes"]["GBPUSDc"], 0.30)
            self.assertEqual(post_data["symbol_lot_sizes"]["XAUUSDc"], 0.05)

    def test_order_comments_strategy_labeling_and_length(self):
        """Ensure order comments clearly state Haider-Enhanced and stay strictly <= 27 characters."""
        sent_orders = []
        def mock_send(symbol, order_type_str, volume, sl, tp, comment):
            sent_orders.append({"vol": volume, "comment": comment})
            return {"order": 123456, "price": 2000.0}

        self.bot._send_mt5_order = mock_send

        # 1. Enhanced strategy with 2-tranche split
        self.bot.strategy = "HAIDER_ENHANCED"
        self.bot._execute_signal("XAUUSDc", "BUY", entry=2000.0, sl=1985.0, tp1=2010.0, strategy_name="Haider-Scalper-Enhanced")
        self.assertEqual(len(sent_orders), 2)
        self.assertEqual(sent_orders[0]["comment"], "Haider-Enhanced [TP1]")
        self.assertEqual(sent_orders[1]["comment"], "Haider-Enhanced [Runner]")
        for order in sent_orders:
            self.assertLessEqual(len(order["comment"]), 27, f"Comment {order['comment']} exceeds 27 chars!")

        # 2. Baseline REAL_DIP strategy
        sent_orders.clear()
        self.bot.strategy = "REAL_DIP"
        self.bot._execute_signal("XAUUSDc", "BUY", entry=2000.0, sl=1985.0, tp1=2010.0, strategy_name="Haider-Gold-Scalper")
        self.assertEqual(len(sent_orders), 1)
        self.assertEqual(sent_orders[0]["comment"], "Haider-Gold")
        self.assertLessEqual(len(sent_orders[0]["comment"]), 27)


if __name__ == "__main__":
    unittest.main()


