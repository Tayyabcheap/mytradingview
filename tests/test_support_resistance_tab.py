"""
Unit tests for Classical Support & Resistance Engine, Confluence Detection, and Setup Generation.
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

from intelligence import calculate_sr_zones, find_sr_confluences, get_primary_sr_setup


class TestSupportResistanceEngine(unittest.TestCase):
    def setUp(self):
        # Generate synthetic price series oscillating between Support (~2640) and Resistance (~2680)
        self.candles = []
        base_time = 1700000000000
        
        # Explicit peaks and valleys to test pivot detection
        # 3 peaks at 2680 and 3 troughs at 2640
        points = [2660, 2670, 2680, 2670, 2650, 2640, 2650, 2670, 2680, 2670, 2650, 2640, 2650, 2670, 2680, 2670, 2650, 2640, 2650, 2660]
        
        for idx, p in enumerate(points):
            # Create a 3-candle ramp to each point
            self.candles.append({
                "timestamp": base_time + idx * 900000,
                "open": float(p - 0.5),
                "high": float(p + (1.5 if p in (2680, 2640) else 0.5)),
                "low": float(p - (1.5 if p in (2680, 2640) else 0.5)),
                "close": float(p),
                "volume": 250
            })

    def test_calculate_sr_zones_identifies_support_and_resistance(self):
        # Current price at 2660 (in between)
        res = calculate_sr_zones(self.candles, timeframe="15M", left=2, right=2, current_price=2660.0)
        self.assertEqual(res["timeframe"], "15M")
        self.assertGreaterEqual(len(res["all_zones"]), 2)
        
        # Check that we have both Support (below 2660) and Resistance (above 2660)
        self.assertGreaterEqual(len(res["support"]), 1)
        self.assertGreaterEqual(len(res["resistance"]), 1)

        nearest_supp = res["nearest_support"]
        nearest_res = res["nearest_resistance"]
        self.assertIsNotNone(nearest_supp)
        self.assertIsNotNone(nearest_res)

        self.assertLess(nearest_supp["level"], 2660.0)
        self.assertGreater(nearest_res["level"], 2660.0)
        self.assertGreaterEqual(nearest_supp["touches"], 2)
        self.assertGreaterEqual(nearest_res["touches"], 2)

    def test_sr_distance_calculations(self):
        res = calculate_sr_zones(self.candles, timeframe="15M", left=2, right=2, current_price=2660.0)
        supp = res["nearest_support"]
        expected_dist_usd = round(abs(2660.0 - supp["level"]), 2)
        expected_dist_pips = round(expected_dist_usd * 10.0, 1)

        self.assertAlmostEqual(supp["distance_usd"], expected_dist_usd, places=2)
        self.assertAlmostEqual(supp["distance_pips"], expected_dist_pips, places=1)

    def test_sr_confluence_detection(self):
        sr_15m = {
            "timeframe": "15M",
            "current_price": 2642.0,
            "all_zones": [{
                "id": "SR_15M_SUP_2640",
                "type": "SUP",
                "side": "SUPPORT",
                "kind": "Support",
                "level": 2640.5,
                "top": 2642.0,
                "bottom": 2639.0,
                "touches": 3,
                "flipped": False,
                "grade": "MAJOR"
            }]
        }
        sr_1h = {
            "timeframe": "1H",
            "current_price": 2642.0,
            "all_zones": [{
                "id": "SR_1H_SUP_2640",
                "type": "SUP",
                "side": "SUPPORT",
                "kind": "Support",
                "level": 2641.0,
                "top": 2643.0,
                "bottom": 2638.5,
                "touches": 4,
                "flipped": True,
                "grade": "MAJOR"
            }]
        }

        confluences = find_sr_confluences(sr_15m, sr_1h)
        self.assertEqual(len(confluences), 1)

        conf = confluences[0]
        self.assertEqual(conf["action"], "BUY")
        self.assertEqual(conf["tf_lower"], "15M")
        self.assertEqual(conf["tf_higher"], "1H")
        self.assertEqual(conf["confluence_range"], "2639.0 - 2642.0")
        self.assertEqual(conf["midpoint"], 2640.5)
        self.assertTrue(conf["flipped"])

        # SL should be below the overlap floor (2639.0)
        self.assertLess(conf["trade_setup"]["sl"], 2639.0)
        # TP1 should be above midpoint with 1:2 R:R
        self.assertGreater(conf["trade_setup"]["tp1"], conf["trade_setup"]["entry"])
        self.assertAlmostEqual(
            conf["trade_setup"]["reward_pts"], 
            round(conf["trade_setup"]["risk_pts"] * 2.0, 3)
        )

    def test_primary_sr_setup_trigger_ready_state(self):
        sr_15m = {
            "timeframe": "15M",
            "current_price": 2641.0,
            "all_zones": [{
                "id": "SR_15M_SUP_2640",
                "type": "SUP",
                "side": "SUPPORT",
                "kind": "Support",
                "level": 2640.5,
                "top": 2642.0,
                "bottom": 2639.0,
                "touches": 3,
                "flipped": False,
                "grade": "MAJOR"
            }]
        }
        sr_1h = {
            "timeframe": "1H",
            "current_price": 2641.0,
            "all_zones": [{
                "id": "SR_1H_SUP_2640",
                "type": "SUP",
                "side": "SUPPORT",
                "kind": "Support",
                "level": 2641.0,
                "top": 2643.0,
                "bottom": 2638.5,
                "touches": 4,
                "flipped": False,
                "grade": "MAJOR"
            }]
        }

        confluences = find_sr_confluences(sr_15m, sr_1h)
        # Gold at 2641.0 is inside 2639.0 - 2642.0 -> TRIGGER_READY
        primary = get_primary_sr_setup(confluences, sr_15m, sr_1h, current_price=2641.0)
        self.assertIsNotNone(primary)
        self.assertEqual(primary["condition"]["state"], "TRIGGER_READY")
        self.assertEqual(primary["trade_setup"]["action"], "BUY")

    def test_doji_support_buy_confirmation(self):
        support_zones = [{
            "id": "SR_15M_SUP_2640",
            "type": "SUP",
            "side": "SUPPORT",
            "level": 2640.0,
            "top": 2641.5,
            "bottom": 2638.5
        }]

        # Create candle series ending with:
        # 1. Normal candles
        # 2. Doji candle testing support (body ~0.05, high 2642.0, low 2638.0)
        # 3. Intermediate candle
        # 4. Breakout candle closing at 2643.5 (> Doji high 2642.0)
        candles = [
            {"open": 2650.0, "high": 2651.0, "low": 2648.0, "close": 2649.0},
            {"open": 2649.0, "high": 2649.5, "low": 2645.0, "close": 2646.0},
            {"open": 2646.0, "high": 2646.5, "low": 2642.0, "close": 2643.0},
            # Doji candle at support (high=2642.0, low=2638.0)
            {"open": 2640.0, "high": 2642.0, "low": 2638.0, "close": 2640.05},
            # Next candle inside
            {"open": 2640.2, "high": 2641.5, "low": 2639.5, "close": 2641.0},
            # Next-to-next candle closes above Doji high wick (2643.5 > 2642.0)
            {"open": 2641.0, "high": 2644.0, "low": 2640.5, "close": 2643.5}
        ]

        from intelligence import detect_sr_confirmations
        confirmations = detect_sr_confirmations(
            candles, 
            support_zones=support_zones, 
            resistance_zones=[], 
            timeframe="15M", 
            current_price=2643.5
        )

        self.assertGreaterEqual(len(confirmations), 1)
        doji_conf = confirmations[0]
        self.assertEqual(doji_conf["type"], "DOJI_SUPPORT_BUY")
        self.assertEqual(doji_conf["status"], "CONFIRMED")
        self.assertEqual(doji_conf["action"], "BUY")
        # SL must be strictly set to the Doji candle's lowest wick (2638.0)
        self.assertEqual(doji_conf["sl"], 2638.0)
        self.assertEqual(doji_conf["doji_high"], 2642.0)
        self.assertEqual(doji_conf["doji_low"], 2638.0)
        self.assertGreater(doji_conf["trigger_close"], doji_conf["doji_high"])

        # Check primary setup reflects Doji SL
        primary = get_primary_sr_setup([], {"all_zones": support_zones}, {"all_zones": []}, current_price=2643.5, confirmations=confirmations)
        self.assertIsNotNone(primary)
        self.assertEqual(primary["trade_setup"]["action"], "BUY")
        self.assertEqual(primary["trade_setup"]["sl"], 2638.0)

    def test_doji_support_sell_breakdown_confirmation(self):
        """
        Tests Support Doji -> Bearish Breakdown Rule:
        If on support a Doji is created, but next or next-to-next candle closes below
        the Doji candle's lowest wick, it confirms a SELL signal with Stop Loss
        locked strictly to the Doji candle's highest wick.
        """
        support_zones = [{
            "id": "SR_15M_SUP_2640",
            "type": "SUP",
            "side": "SUPPORT",
            "level": 2640.0,
            "top": 2641.5,
            "bottom": 2638.5
        }]

        candles = [
            {"open": 2650.0, "high": 2651.0, "low": 2648.0, "close": 2649.0},
            {"open": 2649.0, "high": 2649.5, "low": 2645.0, "close": 2646.0},
            {"open": 2646.0, "high": 2646.5, "low": 2642.0, "close": 2643.0},
            # Doji candle formed on support (high=2642.0, low=2638.0)
            {"open": 2640.0, "high": 2642.0, "low": 2638.0, "close": 2640.05},
            # Next candle inside
            {"open": 2640.2, "high": 2641.0, "low": 2639.0, "close": 2639.5},
            # Next-to-next candle is bearish and closes below Doji lowest wick (2637.0 < 2638.0)
            {"open": 2639.5, "high": 2639.8, "low": 2636.5, "close": 2637.0}
        ]

        from intelligence import detect_sr_confirmations
        confirmations = detect_sr_confirmations(
            candles, 
            support_zones=support_zones, 
            resistance_zones=[], 
            timeframe="15M", 
            current_price=2637.0
        )

        self.assertGreaterEqual(len(confirmations), 1)
        doji_conf = confirmations[0]
        self.assertEqual(doji_conf["type"], "DOJI_SUPPORT_BREAKDOWN_SELL")
        self.assertEqual(doji_conf["status"], "CONFIRMED")
        self.assertEqual(doji_conf["action"], "SELL")
        # SL must be strictly set to the Doji candle's highest wick (2642.0)
        self.assertEqual(doji_conf["sl"], 2642.0)
        self.assertEqual(doji_conf["doji_high"], 2642.0)
        self.assertEqual(doji_conf["doji_low"], 2638.0)
        self.assertLess(doji_conf["trigger_close"], doji_conf["doji_low"])

        # Check primary setup reflects Doji SL for SELL
        primary = get_primary_sr_setup([], {"all_zones": support_zones}, {"all_zones": []}, current_price=2637.0, confirmations=confirmations)
        self.assertIsNotNone(primary)
        self.assertEqual(primary["trade_setup"]["action"], "SELL")
        self.assertEqual(primary["trade_setup"]["sl"], 2642.0)

    def test_doji_resistance_sell_rejection_confirmation(self):
        """
        Tests Resistance Doji -> Bearish Rejection (SELL) Rule:
        A Doji forms at Resistance, followed by a bearish candle with small wicks (~90% sellers)
        closing below the Doji candle's lowest wick. Confirmed SELL signal with SL locked
        strictly to the Doji candle's highest wick.
        """
        resistance_zones = [{
            "id": "SR_15M_RES_2680",
            "type": "RES",
            "side": "RESISTANCE",
            "level": 2680.0,
            "top": 2681.5,
            "bottom": 2678.5
        }]

        candles = [
            {"open": 2670.0, "high": 2671.0, "low": 2668.0, "close": 2669.0},
            {"open": 2669.0, "high": 2674.0, "low": 2669.0, "close": 2673.0},
            {"open": 2673.0, "high": 2678.0, "low": 2672.0, "close": 2677.0},
            # Doji candle formed on resistance (high=2682.0, low=2678.0)
            {"open": 2680.0, "high": 2682.0, "low": 2678.0, "close": 2680.05},
            # Next candle inside
            {"open": 2680.0, "high": 2680.8, "low": 2679.0, "close": 2679.5},
            # Next-to-next candle is strong bearish with small lower wick (~92% sellers)
            # Range = 2679.8 - 2676.0 = 3.8, Seller progress = 3.5 / 3.8 = 92.1%, Lower wick = 0.3 / 3.8 = 7.9%
            {"open": 2679.5, "high": 2679.8, "low": 2676.0, "close": 2676.3}
        ]

        from intelligence import detect_sr_confirmations
        confirmations = detect_sr_confirmations(
            candles, 
            support_zones=[], 
            resistance_zones=resistance_zones, 
            timeframe="15M", 
            current_price=2676.3
        )

        self.assertGreaterEqual(len(confirmations), 1)
        doji_conf = confirmations[0]
        self.assertEqual(doji_conf["type"], "DOJI_RESISTANCE_SELL")
        self.assertEqual(doji_conf["status"], "CONFIRMED")
        self.assertEqual(doji_conf["action"], "SELL")
        # SL must be strictly set to the Doji candle's highest wick (2682.0)
        self.assertEqual(doji_conf["sl"], 2682.0)
        self.assertEqual(doji_conf["doji_high"], 2682.0)
        self.assertEqual(doji_conf["doji_low"], 2678.0)
        self.assertLess(doji_conf["trigger_close"], doji_conf["doji_low"])
        self.assertGreaterEqual(doji_conf["dominance_pct"], 80.0)
        self.assertLessEqual(doji_conf["wick_pct"], 20.0)

        # Check primary setup reflects Doji SL for SELL at resistance
        primary = get_primary_sr_setup([], {"all_zones": []}, {"all_zones": resistance_zones}, current_price=2676.3, confirmations=confirmations)
        self.assertIsNotNone(primary)
        self.assertEqual(primary["trade_setup"]["action"], "SELL")
        self.assertEqual(primary["trade_setup"]["sl"], 2682.0)

    def test_doji_resistance_buy_breakout_confirmation(self):
        """
        Tests Resistance Doji -> Bullish Breakout (BUY) Rule:
        A Doji forms at Resistance, followed by a bullish candle with small wicks (~90% buyers)
        closing above the Doji candle's high wick. Confirmed BUY signal with SL locked
        strictly to the Doji candle's lowest wick.
        """
        resistance_zones = [{
            "id": "SR_15M_RES_2680",
            "type": "RES",
            "side": "RESISTANCE",
            "level": 2680.0,
            "top": 2681.5,
            "bottom": 2678.5
        }]

        candles = [
            {"open": 2670.0, "high": 2671.0, "low": 2668.0, "close": 2669.0},
            {"open": 2669.0, "high": 2674.0, "low": 2669.0, "close": 2673.0},
            {"open": 2673.0, "high": 2678.0, "low": 2672.0, "close": 2677.0},
            # Doji candle formed on resistance (high=2682.0, low=2678.0)
            {"open": 2680.0, "high": 2682.0, "low": 2678.0, "close": 2680.05},
            # Next candle inside
            {"open": 2680.2, "high": 2681.2, "low": 2679.5, "close": 2680.8},
            # Next-to-next candle is strong bullish with small upper wick (~92% buyers)
            # Range = 2684.0 - 2680.2 = 3.8, Buyer progress = 3.5 / 3.8 = 92.1%, Upper wick = 0.3 / 3.8 = 7.9%
            {"open": 2680.5, "high": 2684.0, "low": 2680.2, "close": 2683.7}
        ]

        from intelligence import detect_sr_confirmations
        confirmations = detect_sr_confirmations(
            candles, 
            support_zones=[], 
            resistance_zones=resistance_zones, 
            timeframe="15M", 
            current_price=2683.7
        )

        self.assertGreaterEqual(len(confirmations), 1)
        doji_conf = confirmations[0]
        self.assertEqual(doji_conf["type"], "DOJI_RESISTANCE_BREAKOUT_BUY")
        self.assertEqual(doji_conf["status"], "CONFIRMED")
        self.assertEqual(doji_conf["action"], "BUY")
        # SL must be strictly set to the Doji candle's lowest wick (2678.0)
        self.assertEqual(doji_conf["sl"], 2678.0)
        self.assertEqual(doji_conf["doji_high"], 2682.0)
        self.assertEqual(doji_conf["doji_low"], 2678.0)
        self.assertGreater(doji_conf["trigger_close"], doji_conf["doji_high"])
        self.assertGreaterEqual(doji_conf["dominance_pct"], 80.0)
        self.assertLessEqual(doji_conf["wick_pct"], 20.0)

    def test_doji_confirmation_rejected_when_wicks_are_large(self):
        """
        Tests that an indecisive breakout candle with large wicks (e.g. Shooting Star with 60% upper wick)
        is NOT accepted as a confirmed breakout.
        """
        resistance_zones = [{
            "id": "SR_15M_RES_2680",
            "type": "RES",
            "side": "RESISTANCE",
            "level": 2680.0,
            "top": 2681.5,
            "bottom": 2678.5
        }]

        candles = [
            {"open": 2670.0, "high": 2671.0, "low": 2668.0, "close": 2669.0},
            {"open": 2669.0, "high": 2674.0, "low": 2669.0, "close": 2673.0},
            {"open": 2673.0, "high": 2678.0, "low": 2672.0, "close": 2677.0},
            # Doji candle formed on resistance (high=2682.0, low=2678.0)
            {"open": 2680.0, "high": 2682.0, "low": 2678.0, "close": 2680.05},
            # Next candle inside
            {"open": 2680.2, "high": 2681.2, "low": 2679.5, "close": 2680.8},
            # Next candle closes slightly above 2682.0 at 2682.2, but spiked up to 2686.0 (large 60% upper wick)
            # Range = 2686.0 - 2680.0 = 6.0, Upper wick = 2686.0 - 2682.2 = 3.8 (63% wick!)
            {"open": 2680.5, "high": 2686.0, "low": 2680.0, "close": 2682.2}
        ]

        from intelligence import detect_sr_confirmations
        confirmations = detect_sr_confirmations(
            candles, 
            support_zones=[], 
            resistance_zones=resistance_zones, 
            timeframe="15M", 
            current_price=2682.2
        )

        # Must NOT confirm because candle has large upper wick and lacks 80-90% buyer dominance
        confirmed_signals = [c for c in confirmations if c["status"] == "CONFIRMED"]
        self.assertEqual(len(confirmed_signals), 0)

    def test_wick_spike_above_indecision_without_body_close_is_rejected(self):
        """
        Tests user rule:
        If a candle's wick spikes above the highest point of the indecision candle's wick,
        but the candle body closes below/inside, it is NOT considered a closing and MUST NOT
        trigger a Buy confirmation.
        """
        support_zones = [{
            "id": "SR_15M_SUP_2640",
            "type": "SUP",
            "side": "SUPPORT",
            "level": 2640.0,
            "top": 2641.5,
            "bottom": 2638.5
        }]

        # Indecision high is 2642.0
        # Subsequent candle spikes up to 2644.5 with wick, but closes at 2641.5 (<= 2642.0)
        candles = [
            {"open": 2650.0, "high": 2651.0, "low": 2648.0, "close": 2649.0},
            {"open": 2649.0, "high": 2649.5, "low": 2645.0, "close": 2646.0},
            {"open": 2646.0, "high": 2646.5, "low": 2642.0, "close": 2643.0},
            # 15M Indecision candle at support (high=2642.0, low=2638.0)
            {"open": 2640.0, "high": 2642.0, "low": 2638.0, "close": 2640.05},
            # Subsequent candle: wick spikes up to 2644.5 (> 2642.0), but body closes at 2641.5 (< 2642.0)
            {"open": 2640.2, "high": 2644.5, "low": 2639.5, "close": 2641.5}
        ]

        from intelligence import detect_sr_confirmations
        confirmations = detect_sr_confirmations(
            candles,
            support_zones=support_zones,
            resistance_zones=[],
            timeframe="15M",
            current_price=2641.5
        )

        # Must NOT have any CONFIRMED Buy signals because body did not close above high wick
        confirmed = [c for c in confirmations if c["status"] == "CONFIRMED"]
        self.assertEqual(len(confirmed), 0)

        # Status should remain PENDING awaiting actual full body close
        pending = [c for c in confirmations if c["status"] == "PENDING"]
        self.assertGreaterEqual(len(pending), 1)

    def test_full_body_close_with_more_body_and_less_wick_confirms_trade(self):
        """
        Tests user rule:
        When a subsequent candle achieves a full body close above the highest point of wick,
        with more body and less size of a wick (body >= total_wicks), it confirms the BUY trade
        and sets SL to the indecision candle's lowest wick.
        """
        support_zones = [{
            "id": "SR_15M_SUP_2640",
            "type": "SUP",
            "side": "SUPPORT",
            "level": 2640.0,
            "top": 2641.5,
            "bottom": 2638.5
        }]

        # Indecision candle high=2642.0, low=2638.0
        # Candle +1: wick spike that fails to close (close=2641.0)
        # Candle +2: decisive candle with 82% body and 10% wick, closing at 2644.5 (> 2642.0)
        candles = [
            {"open": 2650.0, "high": 2651.0, "low": 2648.0, "close": 2649.0},
            {"open": 2649.0, "high": 2649.5, "low": 2645.0, "close": 2646.0},
            {"open": 2646.0, "high": 2646.5, "low": 2642.0, "close": 2643.0},
            # 15M Indecision candle
            {"open": 2640.0, "high": 2642.0, "low": 2638.0, "close": 2640.05},
            # Candle +1: normal bullish candle testing/spiking above high wick but closing below (close=2641.5 < 2642.0)
            {"open": 2639.5, "high": 2643.0, "low": 2639.0, "close": 2641.5},
            # Candle +2: decisive full body close (> 2642.0) with large body (open 2641.0, close 2644.5, high 2644.8, low 2640.8)
            # Range: 4.0, Body: 3.5 (87.5%), Upper wick: 0.3 (7.5%), Lower wick: 0.2 (5.0%)
            {"open": 2641.0, "high": 2644.8, "low": 2640.8, "close": 2644.5}
        ]

        from intelligence import detect_sr_confirmations
        confirmations = detect_sr_confirmations(
            candles,
            support_zones=support_zones,
            resistance_zones=[],
            timeframe="15M",
            current_price=2644.5
        )

        confirmed = [c for c in confirmations if c["status"] == "CONFIRMED"]
        self.assertEqual(len(confirmed), 1)
        conf = confirmed[0]

        self.assertEqual(conf["action"], "BUY")
        self.assertTrue(conf["body_closed"])
        self.assertGreaterEqual(conf["body_pct"], 75.0)
        self.assertLessEqual(conf["wick_pct"], 15.0)
        # SL strictly locked to indecision candle lowest wick
        self.assertEqual(conf["sl"], 2638.0)
        self.assertEqual(conf["doji_high"], 2642.0)
        self.assertGreater(conf["trigger_close"], 2642.0)


if __name__ == '__main__':
    unittest.main()

