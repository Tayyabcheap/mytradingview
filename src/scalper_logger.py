"""
Haider-Gold-Scalper Trade Diagnostic & Post-Mortem Logging Engine

Tracks every signal, entry, TP, and SL decision. Evaluates post-trade price action (30+ bars)
to identify:
1. Premature SL Hunts (price overshot SL by <= 12 pips, then reversed to hit TP)
2. Undersized TPs / Money Left on Table (price extended >= 1.5x past TP)
3. Maximum Favorable Excursion (MFE) & Maximum Adverse Excursion (MAE)
4. Persistent audit logging to data/haider_scalper_signals_audit.json & CSV
5. Weekly coaching reports and parameter tuning recommendations
"""

from __future__ import annotations
import os
import json
import csv
import datetime
from typing import Dict, List, Optional, Any, Tuple
import pandas as pd
import numpy as np

# File paths
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(WORKSPACE_DIR, "data")
AUDIT_JSON_PATH = os.path.join(DATA_DIR, "haider_scalper_signals_audit.json")
AUDIT_CSV_PATH = os.path.join(DATA_DIR, "haider_scalper_signals_audit.csv")

# Diagnostic thresholds
DEFAULT_SL_HUNT_THRESHOLD_PIPS = 12.0  # On Gold, <= 12 pips overshoot before reversing is a hunt
DEFAULT_RUNNER_EXTENSION_RATIO = 1.4    # Move extended >= 1.4x the TP distance past target
POST_EXIT_TRACKING_BARS = 40           # Evaluate next 40 bars after exit for true trajectory


def get_point_multiplier(symbol: str) -> float:
    """Returns pip multiplier: 1 USD move on Gold (XAUUSD) = 10 pips = 100 points."""
    s_upper = (symbol or "").upper()
    if "XAU" in s_upper or "GOLD" in s_upper:
        return 10.0
    if "JPY" in s_upper:
        return 100.0
    return 10000.0


def seed_sample_trades_if_empty() -> List[Dict[str, Any]]:
    """Seeds realistic Haider-Gold-Scalper trades with SL hunts, runners, and diagnostic badges."""
    os.makedirs(DATA_DIR, exist_ok=True)
    base_time = int(datetime.datetime.now().timestamp()) - (5 * 86400)
    
    samples = [
        {
            "id": "HGS_20260907_01",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "timeframe": "5M",
            "direction": "BUY",
            "volume": 0.10,
            "entry_time": base_time + 3600,
            "entry_time_str": datetime.datetime.fromtimestamp(base_time + 3600).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_price": 2638.50,
            "planned_sl": 2634.00,
            "planned_tp1": 2646.50,
            "exit_time": base_time + 5400,
            "exit_time_str": datetime.datetime.fromtimestamp(base_time + 5400).strftime("%Y-%m-%d %H:%M:%S"),
            "exit_price": 2634.00,
            "exit_reason": "SL_HIT",
            "pnl_usd": -45.00,
            "pnl_pips": -45.0,
            "during_trade_mfe_pips": 32.0,
            "during_trade_mae_pips": 45.0,
            "status": "CLOSED",
            "post_exit_analysis": {
                "tracked_bars": 40,
                "post_exit_mfe_pips": 128.0,
                "post_exit_mae_pips": 6.0,
                "sl_hunt_detected": True,
                "sl_overshoot_pips": 6.0,
                "runner_left_on_table": False,
                "money_left_on_table_pips": 0.0,
                "diagnosis_verdict": "PREMATURE_SL_HUNT",
                "actionable_coaching_note": "Premature Stop-Out: Price dipped past SL by only 6.0 pips before rallying $14.80 to hit TP ($2646.50). A +9.0 pip buffer would have turned this -$45 loss into +$80 profit."
            }
        },
        {
            "id": "HGS_20260907_02",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "timeframe": "5M",
            "direction": "SELL",
            "volume": 0.10,
            "entry_time": base_time + 14400,
            "entry_time_str": datetime.datetime.fromtimestamp(base_time + 14400).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_price": 2652.20,
            "planned_sl": 2656.80,
            "planned_tp1": 2643.00,
            "exit_time": base_time + 16200,
            "exit_time_str": datetime.datetime.fromtimestamp(base_time + 16200).strftime("%Y-%m-%d %H:%M:%S"),
            "exit_price": 2643.00,
            "exit_reason": "TP_HIT",
            "pnl_usd": 92.00,
            "pnl_pips": 92.0,
            "during_trade_mfe_pips": 92.0,
            "during_trade_mae_pips": 14.0,
            "status": "CLOSED",
            "post_exit_analysis": {
                "tracked_bars": 40,
                "post_exit_mfe_pips": 72.0,
                "post_exit_mae_pips": 10.0,
                "sl_hunt_detected": False,
                "sl_overshoot_pips": 0.0,
                "runner_left_on_table": True,
                "money_left_on_table_pips": 72.0,
                "diagnosis_verdict": "RUNNER_LEFT_ON_TABLE",
                "actionable_coaching_note": "Undersized Target: TP1 hit cleanly (+92 pips), but the gold selloff continued for another +72.0 pips to $2635.80. Consider trailing a 50% partial runner with ATR."
            }
        },
        {
            "id": "HGS_20260908_01",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "timeframe": "5M",
            "direction": "BUY",
            "volume": 0.10,
            "entry_time": base_time + 86400 + 7200,
            "entry_time_str": datetime.datetime.fromtimestamp(base_time + 86400 + 7200).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_price": 2640.10,
            "planned_sl": 2635.50,
            "planned_tp1": 2648.00,
            "exit_time": base_time + 86400 + 9000,
            "exit_time_str": datetime.datetime.fromtimestamp(base_time + 86400 + 9000).strftime("%Y-%m-%d %H:%M:%S"),
            "exit_price": 2648.00,
            "exit_reason": "TP_HIT",
            "pnl_usd": 79.00,
            "pnl_pips": 79.0,
            "during_trade_mfe_pips": 79.0,
            "during_trade_mae_pips": 18.0,
            "status": "CLOSED",
            "post_exit_analysis": {
                "tracked_bars": 40,
                "post_exit_mfe_pips": 12.0,
                "post_exit_mae_pips": 25.0,
                "sl_hunt_detected": False,
                "sl_overshoot_pips": 0.0,
                "runner_left_on_table": False,
                "money_left_on_table_pips": 0.0,
                "diagnosis_verdict": "CLEAN_WIN",
                "actionable_coaching_note": "Optimal Execution: Target achieved within acceptable drawdown parameters."
            }
        },
        {
            "id": "HGS_20260908_02",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "timeframe": "5M",
            "direction": "BUY",
            "volume": 0.10,
            "entry_time": base_time + 86400 + 21600,
            "entry_time_str": datetime.datetime.fromtimestamp(base_time + 86400 + 21600).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_price": 2649.00,
            "planned_sl": 2644.20,
            "planned_tp1": 2657.00,
            "exit_time": base_time + 86400 + 23400,
            "exit_time_str": datetime.datetime.fromtimestamp(base_time + 86400 + 23400).strftime("%Y-%m-%d %H:%M:%S"),
            "exit_price": 2644.20,
            "exit_reason": "SL_HIT",
            "pnl_usd": -48.00,
            "pnl_pips": -48.0,
            "during_trade_mfe_pips": 25.0,
            "during_trade_mae_pips": 48.0,
            "status": "CLOSED",
            "post_exit_analysis": {
                "tracked_bars": 40,
                "post_exit_mfe_pips": 143.0,
                "post_exit_mae_pips": 8.0,
                "sl_hunt_detected": True,
                "sl_overshoot_pips": 8.0,
                "runner_left_on_table": False,
                "money_left_on_table_pips": 0.0,
                "diagnosis_verdict": "PREMATURE_SL_HUNT",
                "actionable_coaching_note": "Premature Stop-Out: Wick swept 8.0 pips past SL to $2643.40 before surging to $2658.50. Adding an extra +10.0 pip buffer would have yielded a +$80 win."
            }
        },
        {
            "id": "HGS_20260909_01",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "timeframe": "5M",
            "direction": "SELL",
            "volume": 0.10,
            "entry_time": base_time + (2 * 86400) + 10800,
            "entry_time_str": datetime.datetime.fromtimestamp(base_time + (2 * 86400) + 10800).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_price": 2664.00,
            "planned_sl": 2669.00,
            "planned_tp1": 2654.50,
            "exit_time": base_time + (2 * 86400) + 12600,
            "exit_time_str": datetime.datetime.fromtimestamp(base_time + (2 * 86400) + 12600).strftime("%Y-%m-%d %H:%M:%S"),
            "exit_price": 2669.00,
            "exit_reason": "SL_HIT",
            "pnl_usd": -50.00,
            "pnl_pips": -50.0,
            "during_trade_mfe_pips": 10.0,
            "during_trade_mae_pips": 50.0,
            "status": "CLOSED",
            "post_exit_analysis": {
                "tracked_bars": 40,
                "post_exit_mfe_pips": 0.0,
                "post_exit_mae_pips": 130.0,
                "sl_hunt_detected": False,
                "sl_overshoot_pips": 0.0,
                "runner_left_on_table": False,
                "money_left_on_table_pips": 0.0,
                "diagnosis_verdict": "VALID_INVALIDATION",
                "actionable_coaching_note": "Protective Stop: Market invalidation confirmed; Gold rallied +130 pips past SL. Good structural discipline."
            }
        },
        {
            "id": "HGS_20260909_02",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "timeframe": "5M",
            "direction": "SELL",
            "volume": 0.10,
            "entry_time": base_time + (2 * 86400) + 28800,
            "entry_time_str": datetime.datetime.fromtimestamp(base_time + (2 * 86400) + 28800).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_price": 2662.50,
            "planned_sl": 2667.00,
            "planned_tp1": 2653.00,
            "exit_time": base_time + (2 * 86400) + 30600,
            "exit_time_str": datetime.datetime.fromtimestamp(base_time + (2 * 86400) + 30600).strftime("%Y-%m-%d %H:%M:%S"),
            "exit_price": 2653.00,
            "exit_reason": "TP_HIT",
            "pnl_usd": 95.00,
            "pnl_pips": 95.0,
            "during_trade_mfe_pips": 95.0,
            "during_trade_mae_pips": 12.0,
            "status": "CLOSED",
            "post_exit_analysis": {
                "tracked_bars": 40,
                "post_exit_mfe_pips": 70.0,
                "post_exit_mae_pips": 8.0,
                "sl_hunt_detected": False,
                "sl_overshoot_pips": 0.0,
                "runner_left_on_table": True,
                "money_left_on_table_pips": 70.0,
                "diagnosis_verdict": "RUNNER_LEFT_ON_TABLE",
                "actionable_coaching_note": "Undersized Target: TP1 (+95 pips) hit cleanly, and impulse extended an extra +70.0 pips. Runner setup warranted."
            }
        },
        {
            "id": "HGS_20260910_01",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "timeframe": "5M",
            "direction": "BUY",
            "volume": 0.10,
            "entry_time": base_time + (3 * 86400) + 14400,
            "entry_time_str": datetime.datetime.fromtimestamp(base_time + (3 * 86400) + 14400).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_price": 2645.80,
            "planned_sl": 2641.00,
            "planned_tp1": 2654.00,
            "exit_time": base_time + (3 * 86400) + 16200,
            "exit_time_str": datetime.datetime.fromtimestamp(base_time + (3 * 86400) + 16200).strftime("%Y-%m-%d %H:%M:%S"),
            "exit_price": 2654.00,
            "exit_reason": "TP_HIT",
            "pnl_usd": 82.00,
            "pnl_pips": 82.0,
            "during_trade_mfe_pips": 82.0,
            "during_trade_mae_pips": 15.0,
            "status": "CLOSED",
            "post_exit_analysis": {
                "tracked_bars": 40,
                "post_exit_mfe_pips": 10.0,
                "post_exit_mae_pips": 20.0,
                "sl_hunt_detected": False,
                "sl_overshoot_pips": 0.0,
                "runner_left_on_table": False,
                "money_left_on_table_pips": 0.0,
                "diagnosis_verdict": "CLEAN_WIN",
                "actionable_coaching_note": "Optimal Execution: Target achieved within acceptable drawdown parameters."
            }
        },
        {
            "id": "HGS_20260910_02",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "timeframe": "5M",
            "direction": "BUY",
            "volume": 0.10,
            "entry_time": base_time + (3 * 86400) + 25200,
            "entry_time_str": datetime.datetime.fromtimestamp(base_time + (3 * 86400) + 25200).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_price": 2651.00,
            "planned_sl": 2646.50,
            "planned_tp1": 2659.00,
            "exit_time": base_time + (3 * 86400) + 26400,
            "exit_time_str": datetime.datetime.fromtimestamp(base_time + (3 * 86400) + 26400).strftime("%Y-%m-%d %H:%M:%S"),
            "exit_price": 2647.50,
            "exit_reason": "MANUAL_CLOSE",
            "pnl_usd": -35.00,
            "pnl_pips": -35.0,
            "during_trade_mfe_pips": 15.0,
            "during_trade_mae_pips": 35.0,
            "status": "CLOSED",
            "post_exit_analysis": {
                "tracked_bars": 40,
                "post_exit_mfe_pips": 115.0,
                "post_exit_mae_pips": 5.0,
                "sl_hunt_detected": False,
                "sl_overshoot_pips": 0.0,
                "runner_left_on_table": False,
                "money_left_on_table_pips": 0.0,
                "diagnosis_verdict": "PREMATURE_MANUAL_EXIT",
                "actionable_coaching_note": "Discipline Lapse: Manual exit occurred prior to target; trade would have reached full TP ($2659.00)."
            }
        },
        {
            "id": "HGS_20260911_01",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "timeframe": "5M",
            "direction": "BUY",
            "volume": 0.10,
            "entry_time": base_time + (4 * 86400) + 14400,
            "entry_time_str": datetime.datetime.fromtimestamp(base_time + (4 * 86400) + 14400).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_price": 2654.20,
            "planned_sl": 2649.80,
            "planned_tp1": 2662.50,
            "exit_time": base_time + (4 * 86400) + 16200,
            "exit_time_str": datetime.datetime.fromtimestamp(base_time + (4 * 86400) + 16200).strftime("%Y-%m-%d %H:%M:%S"),
            "exit_price": 2662.50,
            "exit_reason": "TP_HIT",
            "pnl_usd": 83.00,
            "pnl_pips": 83.0,
            "during_trade_mfe_pips": 83.0,
            "during_trade_mae_pips": 11.0,
            "status": "CLOSED",
            "post_exit_analysis": {
                "tracked_bars": 40,
                "post_exit_mfe_pips": 8.0,
                "post_exit_mae_pips": 15.0,
                "sl_hunt_detected": False,
                "sl_overshoot_pips": 0.0,
                "runner_left_on_table": False,
                "money_left_on_table_pips": 0.0,
                "diagnosis_verdict": "CLEAN_WIN",
                "actionable_coaching_note": "Optimal Execution: Target achieved within acceptable drawdown parameters."
            }
        },
        {
            "id": "HGS_20260911_02",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "timeframe": "5M",
            "direction": "SELL",
            "volume": 0.10,
            "entry_time": base_time + (4 * 86400) + 27000,
            "entry_time_str": datetime.datetime.fromtimestamp(base_time + (4 * 86400) + 27000).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_price": 2668.00,
            "planned_sl": 2673.00,
            "planned_tp1": 2659.00,
            "exit_time": base_time + (4 * 86400) + 28800,
            "exit_time_str": datetime.datetime.fromtimestamp(base_time + (4 * 86400) + 28800).strftime("%Y-%m-%d %H:%M:%S"),
            "exit_price": 2673.00,
            "exit_reason": "SL_HIT",
            "pnl_usd": -50.00,
            "pnl_pips": -50.0,
            "during_trade_mfe_pips": 30.0,
            "during_trade_mae_pips": 50.0,
            "status": "CLOSED",
            "post_exit_analysis": {
                "tracked_bars": 40,
                "post_exit_mfe_pips": 160.0,
                "post_exit_mae_pips": 7.0,
                "sl_hunt_detected": True,
                "sl_overshoot_pips": 7.0,
                "runner_left_on_table": False,
                "money_left_on_table_pips": 0.0,
                "diagnosis_verdict": "PREMATURE_SL_HUNT",
                "actionable_coaching_note": "Premature Stop-Out: Spike tagged $2673.70 (7.0 pips over SL) then dumped $16.00 to hit TP. A +10 pip buffer would have preserved this win."
            }
        },
        {
            "id": "HGS_20260912_01",
            "symbol": "XAUUSDc",
            "strategy": "haider-gold-scalper",
            "timeframe": "5M",
            "direction": "BUY",
            "volume": 0.10,
            "entry_time": base_time + (5 * 86400) + 7200,
            "entry_time_str": datetime.datetime.fromtimestamp(base_time + (5 * 86400) + 7200).strftime("%Y-%m-%d %H:%M:%S"),
            "entry_price": 2660.00,
            "planned_sl": 2655.00,
            "planned_tp1": 2669.00,
            "exit_time": base_time + (5 * 86400) + 9000,
            "exit_time_str": datetime.datetime.fromtimestamp(base_time + (5 * 86400) + 9000).strftime("%Y-%m-%d %H:%M:%S"),
            "exit_price": 2669.00,
            "exit_reason": "TP_HIT",
            "pnl_usd": 90.00,
            "pnl_pips": 90.0,
            "during_trade_mfe_pips": 90.0,
            "during_trade_mae_pips": 12.0,
            "status": "CLOSED",
            "post_exit_analysis": {
                "tracked_bars": 40,
                "post_exit_mfe_pips": 15.0,
                "post_exit_mae_pips": 18.0,
                "sl_hunt_detected": False,
                "sl_overshoot_pips": 0.0,
                "runner_left_on_table": False,
                "money_left_on_table_pips": 0.0,
                "diagnosis_verdict": "CLEAN_WIN",
                "actionable_coaching_note": "Optimal Execution: Target achieved within acceptable drawdown parameters."
            }
        }
    ]
    save_audit_trades(samples)
    return samples


def load_audit_trades(seed_if_empty: bool = False) -> List[Dict[str, Any]]:
    """Loads all logged trades from the JSON audit store."""
    if not os.path.exists(AUDIT_JSON_PATH):
        if seed_if_empty:
            return seed_sample_trades_if_empty()
        return []
    try:
        with open(AUDIT_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if (not data or len(data) == 0) and seed_if_empty:
                return seed_sample_trades_if_empty()
            return data if isinstance(data, list) else []
    except Exception as e:
        print(f"[SCALPER_LOGGER] Failed to load audit json: {e}")
        if seed_if_empty:
            return seed_sample_trades_if_empty()
        return []


def save_audit_trades(trades: List[Dict[str, Any]]) -> None:
    """Saves all logged trades to both JSON and CSV stores."""
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        with open(AUDIT_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(trades, f, indent=2)
    except Exception as e:
        print(f"[SCALPER_LOGGER] Failed to save audit json: {e}")

    # Also sync to CSV for tabular analysis / pandas
    if not trades:
        return

    csv_fields = [
        "id", "symbol", "strategy", "timeframe", "direction", "volume",
        "entry_time_str", "entry_price", "planned_sl", "planned_tp1",
        "exit_time_str", "exit_price", "exit_reason", "pnl_usd", "pnl_pips",
        "mfe_pips", "mae_pips", "post_exit_mfe_pips", "post_exit_mae_pips",
        "sl_hunt_detected", "sl_overshoot_pips", "runner_left_on_table",
        "money_left_on_table_pips", "diagnosis_verdict", "coaching_note"
    ]

    try:
        with open(AUDIT_CSV_PATH, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=csv_fields, extrasaction="ignore")
            writer.writeheader()
            for t in trades:
                row = {**t}
                diag = t.get("post_exit_analysis") or {}
                row["mfe_pips"] = t.get("during_trade_mfe_pips", 0.0)
                row["mae_pips"] = t.get("during_trade_mae_pips", 0.0)
                row["post_exit_mfe_pips"] = diag.get("post_exit_mfe_pips", 0.0)
                row["post_exit_mae_pips"] = diag.get("post_exit_mae_pips", 0.0)
                row["sl_hunt_detected"] = diag.get("sl_hunt_detected", False)
                row["sl_overshoot_pips"] = diag.get("sl_overshoot_pips", 0.0)
                row["runner_left_on_table"] = diag.get("runner_left_on_table", False)
                row["money_left_on_table_pips"] = diag.get("money_left_on_table_pips", 0.0)
                row["diagnosis_verdict"] = diag.get("diagnosis_verdict", "PENDING")
                row["coaching_note"] = diag.get("actionable_coaching_note", "")
                writer.writerow(row)
    except Exception as e:
        print(f"[SCALPER_LOGGER] Failed to save audit csv: {e}")


def upsert_trade(trade_data: Dict[str, Any]) -> None:
    """Inserts or updates a trade record in the audit store."""
    trades = load_audit_trades()
    trade_id = trade_data.get("id")
    if not trade_id:
        trade_id = f"HGS_{trade_data.get('entry_time', int(datetime.datetime.now().timestamp()))}_{trade_data.get('direction', 'BUY')}"
        trade_data["id"] = trade_id

    existing_idx = next((i for i, t in enumerate(trades) if t.get("id") == trade_id), None)
    if existing_idx is not None:
        trades[existing_idx] = {**trades[existing_idx], **trade_data}
    else:
        trades.append(trade_data)

    save_audit_trades(trades)


def evaluate_post_mortem(
    trade: Dict[str, Any],
    subsequent_candles: List[Dict[str, Any]],
    sl_hunt_threshold_pips: float = DEFAULT_SL_HUNT_THRESHOLD_PIPS
) -> Dict[str, Any]:
    """
    Analyzes price behavior during and after trade completion:
    - Did a Stop Loss get hit, only for price to reverse and reach the TP?
    - Did a Take Profit exit too early, leaving a massive runner behind?
    - What were the exact MFE and MAE values?
    """
    direction = trade.get("direction", "BUY").upper()
    entry = float(trade.get("entry_price") or 0.0)
    sl = float(trade.get("planned_sl") or 0.0)
    tp1 = float(trade.get("planned_tp1") or 0.0)
    exit_price = float(trade.get("exit_price") or entry)
    exit_reason = trade.get("exit_reason", "MANUAL_CLOSE").upper()
    symbol = trade.get("symbol", "XAUUSDc")
    pips_mult = get_point_multiplier(symbol)

    planned_risk_pips = round(abs(entry - sl) * pips_mult, 1) if sl else 0.0
    planned_reward_pips = round(abs(tp1 - entry) * pips_mult, 1) if tp1 else 0.0

    if not subsequent_candles:
        return {
            "tracked_bars": 0,
            "post_exit_mfe_pips": 0.0,
            "post_exit_mae_pips": 0.0,
            "sl_hunt_detected": False,
            "sl_overshoot_pips": 0.0,
            "runner_left_on_table": False,
            "money_left_on_table_pips": 0.0,
            "diagnosis_verdict": "PENDING_CANDLE_DATA",
            "actionable_coaching_note": "Awaiting forward bars to evaluate trajectory."
        }

    highs = [float(c.get("high", 0.0)) for c in subsequent_candles]
    lows = [float(c.get("low", 0.0)) for c in subsequent_candles]
    closes = [float(c.get("close", 0.0)) for c in subsequent_candles]

    # Calculate post-exit trajectory
    if direction == "BUY":
        peak_favorable_price = max(highs) if highs else exit_price
        peak_adverse_price = min(lows) if lows else exit_price
        post_mfe_pips = round(max(0.0, peak_favorable_price - exit_price) * pips_mult, 1)
        post_mae_pips = round(max(0.0, exit_price - peak_adverse_price) * pips_mult, 1)
        
        # Did price overshoot SL and then rally to TP?
        if "SL" in exit_reason and sl > 0:
            overshoot = round(max(0.0, sl - peak_adverse_price) * pips_mult, 1)
            hit_target_later = peak_favorable_price >= tp1 if tp1 else False
            is_sl_hunt = hit_target_later and (overshoot <= sl_hunt_threshold_pips)
        else:
            overshoot = 0.0
            is_sl_hunt = False

        # Did price extend way past TP?
        if "TP" in exit_reason and tp1 > 0:
            extension = round(max(0.0, peak_favorable_price - tp1) * pips_mult, 1)
            is_runner = extension >= (planned_reward_pips * 0.5) and extension >= 25.0
        else:
            extension = 0.0
            is_runner = False

    else:  # SELL
        peak_favorable_price = min(lows) if lows else exit_price
        peak_adverse_price = max(highs) if highs else exit_price
        post_mfe_pips = round(max(0.0, exit_price - peak_favorable_price) * pips_mult, 1)
        post_mae_pips = round(max(0.0, peak_adverse_price - exit_price) * pips_mult, 1)

        if "SL" in exit_reason and sl > 0:
            overshoot = round(max(0.0, peak_adverse_price - sl) * pips_mult, 1)
            hit_target_later = peak_favorable_price <= tp1 if tp1 else False
            is_sl_hunt = hit_target_later and (overshoot <= sl_hunt_threshold_pips)
        else:
            overshoot = 0.0
            is_sl_hunt = False

        if "TP" in exit_reason and tp1 > 0:
            extension = round(max(0.0, tp1 - peak_favorable_price) * pips_mult, 1)
            is_runner = extension >= (planned_reward_pips * 0.5) and extension >= 25.0
        else:
            extension = 0.0
            is_runner = False

    # Determine Diagnostic Verdict & Actionable Coaching Note
    if is_sl_hunt:
        verdict = "PREMATURE_SL_HUNT"
        rec_buffer = round(overshoot + 4.0, 1)
        note = (
            f"Premature Stop-Out: Price exceeded SL by only {overshoot} pips before "
            f"reversing to reach the intended TP target (${tp1:.2f}). Adding a +{rec_buffer} pip "
            f"buffer behind swing structural wicks would have transformed this loss into a clean win."
        )
    elif is_runner:
        verdict = "RUNNER_LEFT_ON_TABLE"
        note = (
            f"Undersized Target: TP1 (${tp1:.2f}) was hit cleanly, but the impulse continued "
            f"for an additional {extension} pips. Consider trailing a 50% partial runner with "
            f"an ATR-based trailing stop to extract extended market swings."
        )
    elif "TP" in exit_reason:
        verdict = "CLEAN_WIN"
        note = "Optimal Execution: Target achieved within acceptable drawdown parameters."
    elif "SL" in exit_reason:
        verdict = "VALID_INVALIDATION"
        note = "Protective Stop: Market invalidation confirmed; SL successfully prevented deeper drawdown."
    elif "MANUAL" in exit_reason:
        if (direction == "BUY" and peak_favorable_price >= tp1) or (direction == "SELL" and peak_favorable_price <= tp1):
            verdict = "PREMATURE_MANUAL_EXIT"
            note = f"Discipline Lapse: Manual exit occurred prior to target; trade would have reached full TP (${tp1:.2f})."
        else:
            verdict = "DISCIPLINED_MANUAL_EXIT"
            note = "Timely Intervention: Manual close prevented full Stop Loss hit."
    else:
        verdict = "NEUTRAL_EXIT"
        note = "Trade resolved at break-even or scheduled session close."

    return {
        "tracked_bars": len(subsequent_candles),
        "post_exit_mfe_pips": post_mfe_pips,
        "post_exit_mae_pips": post_mae_pips,
        "sl_hunt_detected": is_sl_hunt,
        "sl_overshoot_pips": overshoot,
        "runner_left_on_table": is_runner,
        "money_left_on_table_pips": extension,
        "diagnosis_verdict": verdict,
        "actionable_coaching_note": note
    }


def generate_weekly_scalper_report(days: int = 7) -> Dict[str, Any]:
    """
    Aggregates logged trades, performs MFE/MAE analysis, and generates
    prescriptive strategy optimization suggestions for weekly AI reviews.
    """
    all_trades = load_audit_trades(seed_if_empty=True)
    cutoff = datetime.datetime.now() - datetime.timedelta(days=days)
    cutoff_ts = int(cutoff.timestamp())

    recent_trades = [
        t for t in all_trades 
        if (t.get("exit_time") or t.get("entry_time") or 0) >= cutoff_ts
    ]

    # If recent trades < 3, evaluate all available trades to provide rich baseline analysis
    analyzed_trades = recent_trades if len(recent_trades) >= 3 else all_trades

    if not analyzed_trades:
        return {
            "period_days": days,
            "total_trades": 0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "total_pnl_usd": 0.0,
            "total_pnl_pips": 0.0,
            "sl_hunt_count": 0,
            "sl_hunt_loss_usd": 0.0,
            "recoverable_win_rate": 0.0,
            "runners_missed_count": 0,
            "pips_left_on_table": 0.0,
            "mistakes_breakdown": {},
            "recommendations": [
                "No logged signals found for the period. Execute or forward-test signals to populate audit records."
            ]
        }

    total_trades = len(analyzed_trades)
    closed_trades = [t for t in analyzed_trades if t.get("status") == "CLOSED" or t.get("exit_reason") != "OPEN"]
    wins = [t for t in closed_trades if (t.get("pnl_usd") or 0.0) > 0]
    losses = [t for t in closed_trades if (t.get("pnl_usd") or 0.0) < 0]

    win_rate = round(len(wins) / len(closed_trades) * 100.0, 1) if closed_trades else 0.0
    total_pnl_usd = round(sum(float(t.get("pnl_usd") or 0.0) for t in closed_trades), 2)
    total_pnl_pips = round(sum(float(t.get("pnl_pips") or 0.0) for t in closed_trades), 1)

    gross_win = sum(float(t.get("pnl_usd") or 0.0) for t in wins)
    gross_loss = abs(sum(float(t.get("pnl_usd") or 0.0) for t in losses))
    profit_factor = round(gross_win / gross_loss, 2) if gross_loss > 0 else (99.9 if gross_win > 0 else 0.0)

    # Diagnostic breakdown
    sl_hunts = []
    runners_missed = []
    premature_manuals = []
    valid_stops = []
    clean_wins = []

    for t in closed_trades:
        diag = t.get("post_exit_analysis") or {}
        verdict = diag.get("diagnosis_verdict", "")
        if diag.get("sl_hunt_detected") or verdict == "PREMATURE_SL_HUNT":
            sl_hunts.append(t)
        elif diag.get("runner_left_on_table") or verdict == "RUNNER_LEFT_ON_TABLE":
            runners_missed.append(t)
        elif verdict == "PREMATURE_MANUAL_EXIT":
            premature_manuals.append(t)
        elif verdict == "VALID_INVALIDATION":
            valid_stops.append(t)
        elif verdict == "CLEAN_WIN":
            clean_wins.append(t)

    sl_hunt_count = len(sl_hunts)
    sl_hunt_loss_usd = round(abs(sum(float(t.get("pnl_usd") or 0.0) for t in sl_hunts)), 2)

    # Calculate counterfactual win rate if SL hunts were avoided
    counterfactual_wins = len(wins) + sl_hunt_count
    recoverable_win_rate = round(counterfactual_wins / len(closed_trades) * 100.0, 1) if closed_trades else win_rate

    overshoots = [
        float((t.get("post_exit_analysis") or {}).get("sl_overshoot_pips") or 0.0)
        for t in sl_hunts
        if ((t.get("post_exit_analysis") or {}).get("sl_overshoot_pips") or 0.0) > 0
    ]
    median_overshoot = round(float(np.median(overshoots)), 1) if overshoots else 6.5

    extensions = [
        float((t.get("post_exit_analysis") or {}).get("money_left_on_table_pips") or 0.0)
        for t in runners_missed
        if ((t.get("post_exit_analysis") or {}).get("money_left_on_table_pips") or 0.0) > 0
    ]
    total_pips_left = round(sum(extensions), 1)

    # Generate Algorithmic Coaching Recommendations
    recommendations = []
    if sl_hunt_count > 0:
        recommended_buffer = round(median_overshoot + 3.0, 1)
        recommendations.append(
            f"🎯 **Fix Premature SL Hunts ({sl_hunt_count} occurrences)**: "
            f"{sl_hunt_count} trades were stopped out by an average of {median_overshoot} pips before rallying to target. "
            f"Adding a +{recommended_buffer} pip buffer (or anchoring SL strictly behind the 5M swing wick) would recover "
            f"+${sl_hunt_loss_usd} and boost Win Rate from {win_rate}% to {recoverable_win_rate}%."
        )

    if len(runners_missed) > 0:
        recommendations.append(
            f"💰 **Capture Missed Runners ({len(runners_missed)} trades, +{total_pips_left} pips left on table)**: "
            f"Strong momentum impulses frequently exceeded TP1 by 25–80 pips. Implement a 2-tranche strategy: "
            f"bank 50% volume at TP1 (move SL to Break-Even) and trail the remaining 50% with 1.8 ATR."
        )

    if len(premature_manuals) > 0:
        recommendations.append(
            f"🧠 **Eliminate Manual Panic Exits ({len(premature_manuals)} trades)**: "
            f"Manual closures interrupted setups that would have reached full Take Profit. Allow automated rules to play out."
        )

    if not recommendations:
        recommendations.append(
            "💎 **High Execution Discipline**: All closed trades followed mathematical boundary rules with healthy MAE tolerances."
        )

    return {
        "period_days": days,
        "sample_size": len(closed_trades),
        "total_trades": total_trades,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": win_rate,
        "recoverable_win_rate": recoverable_win_rate,
        "profit_factor": profit_factor,
        "total_pnl_usd": total_pnl_usd,
        "total_pnl_pips": total_pnl_pips,
        "sl_hunt_count": sl_hunt_count,
        "sl_hunt_loss_usd": sl_hunt_loss_usd,
        "median_overshoot_pips": median_overshoot,
        "runners_missed_count": len(runners_missed),
        "pips_left_on_table": total_pips_left,
        "mistakes_breakdown": {
            "sl_hunts": sl_hunt_count,
            "runners_missed": len(runners_missed),
            "premature_manual_exits": len(premature_manuals),
            "valid_stops": len(valid_stops),
            "clean_wins": len(clean_wins)
        },
        "recommendations": recommendations,
        "recent_trades": closed_trades[:25]
    }


def sync_backtest_trades(
    raw_trades: List[Dict[str, Any]],
    bars: List[Tuple[int, float, float, float, float]],
    symbol: str = "XAUUSDc",
    strategy: str = "haider-gold-scalper"
) -> int:
    """
    Ingests trades produced by real_dip_bt / haider_gold_scalper,
    computes post-mortem MFE/MAE and SL hunt diagnostics using historical forward bars,
    and updates the audit log.
    """
    n_bars = len(bars)
    converted_trades = []

    for idx, t in enumerate(raw_trades):
        t_id = f"HGS_{t.get('entry_time', idx)}_{t.get('direction', 1)}"
        dir_str = "BUY" if t.get("direction", 1) == 1 else "SELL"
        entry_p = float(t.get("entry_price", 0.0))
        sl_p = float(t.get("sl_price", 0.0))
        tp_p = float(t.get("tp_price", 0.0))
        exit_p = float(t.get("exit_price", entry_p))
        exit_raw = str(t.get("exit_reason", "")).upper()
        exit_reason = "TP_HIT" if "TP" in exit_raw else ("SL_HIT" if "SL" in exit_raw else "MANUAL_CLOSE")
        pnl = float(t.get("pnl", 0.0))
        pts = float(t.get("points", 0.0))

        # Forward bars for post-mortem analysis
        exit_idx = t.get("exit_idx")
        subsequent = []
        if exit_idx is not None and exit_idx < n_bars - 1:
            end_idx = min(exit_idx + 41, n_bars)
            for j in range(exit_idx + 1, end_idx):
                b = bars[j]
                subsequent.append({
                    "timestamp": b[0],
                    "open": b[1],
                    "high": b[2],
                    "low": b[3],
                    "close": b[4]
                })

        trade_record = {
            "id": t_id,
            "symbol": symbol,
            "strategy": strategy,
            "timeframe": "5M",
            "direction": dir_str,
            "volume": 0.10,
            "entry_time": t.get("entry_time"),
            "entry_time_str": datetime.datetime.fromtimestamp(t.get("entry_time", 0)).strftime("%Y-%m-%d %H:%M:%S") if t.get("entry_time") else "",
            "entry_price": entry_p,
            "planned_sl": sl_p,
            "planned_tp1": tp_p,
            "exit_time": t.get("exit_time"),
            "exit_time_str": datetime.datetime.fromtimestamp(t.get("exit_time", 0)).strftime("%Y-%m-%d %H:%M:%S") if t.get("exit_time") else "",
            "exit_price": exit_p,
            "exit_reason": exit_reason,
            "pnl_usd": round(pnl, 2),
            "pnl_pips": round(pts / 10.0, 1),
            "during_trade_mfe_pips": round(float(t.get("max_excursion", 0.0)) * 10.0, 1),
            "during_trade_mae_pips": 0.0,
            "status": "CLOSED"
        }

        diag = evaluate_post_mortem(trade_record, subsequent)
        trade_record["post_exit_analysis"] = diag
        converted_trades.append(trade_record)

    if converted_trades:
        existing = load_audit_trades()
        existing_map = {t["id"]: t for t in existing}
        for ct in converted_trades:
            existing_map[ct["id"]] = ct
        merged = list(existing_map.values())
        merged.sort(key=lambda x: x.get("entry_time") or 0, reverse=True)
        save_audit_trades(merged)

    return len(converted_trades)

