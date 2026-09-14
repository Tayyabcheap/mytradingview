"""
Comprehensive unit and integration test suite for Trade-with-Rakhi.
Tests symbol categorization, MT5 deal-pairing journal engine, statistics math,
and strict safety limit rules (Gold max lot <= 1.0).
"""

import os
import sys
import datetime
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

from journal_engine import (
    categorize_symbol,
    parse_mt5_deals_to_trades,
    calculate_trade_statistics,
    format_duration
)
from app import app, TF_MAP


class TestSymbolCategorization(unittest.TestCase):
    def test_crypto_categorization(self):
        self.assertEqual(categorize_symbol("BTCUSDc", "Cent\\Crypto\\BTCUSDc"), "Crypto")
        self.assertEqual(categorize_symbol("ETHUSDc", "Cent\\Crypto\\ETHUSDc"), "Crypto")
        self.assertEqual(categorize_symbol("BTCUSDTc"), "Crypto")
        self.assertEqual(categorize_symbol("SOLUSD"), "Crypto")

    def test_commodities_categorization(self):
        self.assertEqual(categorize_symbol("XAUUSDc", "Cent\\Forex\\XAUUSDc", "Gold vs US Dollar"), "Commodities")
        self.assertEqual(categorize_symbol("XAGUSDc", "Cent\\Forex\\XAGUSDc", "Silver vs US Dollar"), "Commodities")
        self.assertEqual(categorize_symbol("USOIL", "Commodities\\USOIL"), "Commodities")
        self.assertEqual(categorize_symbol("UKOIL"), "Commodities")

    def test_indices_categorization(self):
        self.assertEqual(categorize_symbol("US30", "Indices\\US30"), "Indices")
        self.assertEqual(categorize_symbol("NAS100"), "Indices")
        self.assertEqual(categorize_symbol("GER40"), "Indices")

    def test_forex_categorization(self):
        self.assertEqual(categorize_symbol("EURUSDc", "Cent\\Forex\\EURUSDc"), "Forex")
        self.assertEqual(categorize_symbol("GBPUSDc"), "Forex")
        self.assertEqual(categorize_symbol("USDJPYc"), "Forex")
        self.assertEqual(categorize_symbol("AUDCADc"), "Forex")


class TestJournalEngine(unittest.TestCase):
    def test_format_duration(self):
        self.assertEqual(format_duration(45), "45s")
        self.assertEqual(format_duration(180), "3m")
        self.assertEqual(format_duration(3700), "1h 1m")
        self.assertEqual(format_duration(90000), "1d 1h")

    def test_deal_pairing_round_trip(self):
        # Synthetic entry & exit deals for position_id 1001
        deals = [
            {
                "ticket": 5001,
                "order": 1001,
                "position_id": 1001,
                "entry": 0, # ENTRY_IN
                "type": 0,  # BUY
                "volume": 0.5,
                "price": 2000.0,
                "time": 1700000000,
                "time_msc": 1700000000000,
                "symbol": "XAUUSDc",
                "commission": -1.0,
                "swap": 0.0,
                "profit": 0.0,
                "comment": "Test Entry"
            },
            {
                "ticket": 5002,
                "order": 1002,
                "position_id": 1001,
                "entry": 1, # ENTRY_OUT
                "type": 1,  # SELL
                "volume": 0.5,
                "price": 2020.0,
                "time": 1700003600,
                "time_msc": 1700003600000,
                "symbol": "XAUUSDc",
                "commission": -1.0,
                "swap": 0.0,
                "profit": 100.0,
                "reason": 5, # TP hit
                "comment": "[tp 2020.0]"
            }
        ]

        trades = parse_mt5_deals_to_trades(deals)
        self.assertEqual(len(trades), 1)
        t = trades[0]
        self.assertEqual(t["ticket"], 1001)
        self.assertEqual(t["symbol"], "XAUUSDc")
        self.assertEqual(t["category"], "Commodities")
        self.assertEqual(t["type"], "BUY")
        self.assertEqual(t["volume"], 0.5)
        self.assertEqual(t["open_price"], 2000.0)
        self.assertEqual(t["close_price"], 2020.0)
        self.assertEqual(t["exit_reason"], "TP Hit")
        self.assertEqual(t["status"], "CLOSED")
        self.assertEqual(t["net_pnl"], 98.0) # 100 profit - 2 commission
        self.assertEqual(t["duration_sec"], 3600)

    def test_statistics_math(self):
        trades = [
            {"status": "CLOSED", "net_pnl": 100.0, "open_time": 1700000000, "close_time": 1700001000, "exit_reason": "TP Hit"},
            {"status": "CLOSED", "net_pnl": 150.0, "open_time": 1700002000, "close_time": 1700003000, "exit_reason": "TP Hit"},
            {"status": "CLOSED", "net_pnl": -50.0, "open_time": 1700004000, "close_time": 1700005000, "exit_reason": "SL Hit"},
            {"status": "CLOSED", "net_pnl": -50.0, "open_time": 1700006000, "close_time": 1700007000, "exit_reason": "SL Hit"}
        ]

        stats = calculate_trade_statistics(trades)
        self.assertEqual(stats["total_trades"], 4)
        self.assertEqual(stats["winning_trades"], 2)
        self.assertEqual(stats["losing_trades"], 2)
        self.assertEqual(stats["win_rate"], 50.0)
        self.assertEqual(stats["net_pnl"], 150.0)
        self.assertEqual(stats["gross_profit"], 250.0)
        self.assertEqual(stats["gross_loss"], 100.0)
        self.assertEqual(stats["profit_factor"], 2.5)
        self.assertEqual(stats["avg_win"], 125.0)
        self.assertEqual(stats["avg_loss"], -50.0)
        self.assertEqual(stats["payoff_ratio"], 2.5)
        self.assertEqual(stats["tp_hits"], 2)
        self.assertEqual(stats["sl_hits"], 2)


class TestSafetyLimitsAndEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_gold_safety_limit_rejection(self):
        """Mandatory Rule: Gold trades > 1.0 lot must be rejected."""
        res = self.client.post('/api/order/send', json={
            "symbol": "XAUUSDc",
            "type": "BUY",
            "volume": 1.5,
            "sl": 2000.0,
            "tp": 2100.0
        })
        self.assertEqual(res.status_code, 400)
        data = res.get_json()
        self.assertIn("Safety Limit", data.get("error", ""))

    def test_account_endpoint(self):
        res = self.client.get('/api/account')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("balance", data)
        self.assertIn("equity", data)
        self.assertIn("currency", data)

    def test_symbols_endpoint(self):
        res = self.client.get('/api/symbols')
        self.assertEqual(res.status_code, 200)
        symbols = res.get_json()
        self.assertTrue(isinstance(symbols, list))
        if symbols:
            first = symbols[0]
            self.assertIn("name", first)
            self.assertIn("category", first)

    def test_journal_trades_endpoint(self):
        res = self.client.get('/api/journal/trades?days=30')
        self.assertEqual(res.status_code, 200)
        trades = res.get_json()
        self.assertTrue(isinstance(trades, list))

    def test_journal_stats_endpoint(self):
        res = self.client.get('/api/journal/stats?days=30')
        self.assertEqual(res.status_code, 200)
        stats = res.get_json()
        self.assertIn("win_rate", stats)
        self.assertIn("net_pnl", stats)
    def test_app_update_status_endpoint(self):
        res = self.client.get('/api/app/update-status')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("ok"))
        self.assertIn("up_to_date", data)
        self.assertIn("behind", data)
        self.assertIn("dirty", data)


if __name__ == '__main__':
    unittest.main()
