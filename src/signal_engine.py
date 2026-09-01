"""
MyFinanceAdvisor - Dual Strategy Signal Engine
==============================================
"""

from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

import config
from indicators import (
    detect_sr_zones,
    nearest_sr,
    recent_swing_high,
    recent_swing_low,
)

SWING_CORE = "SWING_CORE"
SWING_PRO = "SWING_PRO"

class SignalEngine:
    def __init__(self) -> None:
        self.last_reject: Optional[str] = None
        self.sr_zones: List[Dict] = []

    def prepare_sr(self, df_htf: pd.DataFrame) -> None:
        self.sr_zones = detect_sr_zones(df_htf, recent_only=True)

    def evaluate_bar(self, df: pd.DataFrame, idx: int, strategy: str = SWING_CORE) -> Optional[Dict]:
        if idx < config.SL_LOOKBACK_BARS + 5:
            self.last_reject = "Not enough bars to evaluate"
            return None

        row = df.iloc[idx]
        if pd.isna(row.get("ema_200_htf")) or pd.isna(row.get("rsi")):
            self.last_reject = "HTF/ITF calculations not ready"
            return None

        bias = "RANGE"
        if row.get("close_htf", row["close"]) > row.get("ema_200_htf", 0):
            bias = "BULLISH"
        elif row.get("close_htf", row["close"]) < row.get("ema_200_htf", float('inf')):
            bias = "BEARISH"
            
        if strategy == SWING_CORE:
            return self.evaluate_swing_core(df, idx, row, bias)
        elif strategy == SWING_PRO:
            return self.evaluate_swing_pro(df, idx, row, bias)
        return None

    def evaluate_swing_core(self, df: pd.DataFrame, idx: int, row: pd.Series, bias: str) -> Optional[Dict]:
        """
        Trend-Pullback Strategy (>75% hit rate target)
        """
        # 1. Macro Trend Alignment
        if bias not in ("BULLISH", "BEARISH"):
            self.last_reject = "SWING_CORE: Trend not established"
            return None

        # 2. RSI Pullback condition on 4H
        if bias == "BULLISH":
            if row.get("rsi_min_lookback", 50) > config.RSI_OVERSOLD:
                self.last_reject = "SWING_CORE: No recent oversold pullback"
                return None
        else:
            if row.get("rsi_max_lookback", 50) < config.RSI_OVERBOUGHT:
                self.last_reject = "SWING_CORE: No recent overbought pullback"
                return None

        # 3. MACD Momentum Shift
        if bias == "BULLISH":
            if row.get("macd_hist", -1) < 0:
                self.last_reject = "SWING_CORE: MACD momentum still bearish"
                return None
        else:
            if row.get("macd_hist", 1) > 0:
                self.last_reject = "SWING_CORE: MACD momentum still bullish"
                return None

        # 4. Candlestick Trigger
        if bias == "BULLISH" and not (row.get("bullish_engulfing") or row.get("bullish_pinbar")):
            self.last_reject = "SWING_CORE: No bullish trigger candle"
            return None
        if bias == "BEARISH" and not (row.get("bearish_engulfing") or row.get("bearish_pinbar")):
            self.last_reject = "SWING_CORE: No bearish trigger candle"
            return None

        return self._build_signal(df, idx, row, SWING_CORE, "BUY" if bias == "BULLISH" else "SELL", bias)

    def evaluate_swing_pro(self, df: pd.DataFrame, idx: int, row: pd.Series, bias: str) -> Optional[Dict]:
        """
        Macro Reversal Breakout
        """
        prev = df.iloc[idx - 1]
        # Require the close to clear EMA-50 by a margin, not just tick across it (filters noisy whipsaw crosses).
        margin = config.pips(20)
        is_break_up = prev["close"] < prev["ema_50"] and row["close"] > row["ema_50"] + margin and bias == "BULLISH"
        is_break_down = prev["close"] > prev["ema_50"] and row["close"] < row["ema_50"] - margin and bias == "BEARISH"

        if not is_break_up and not is_break_down:
            self.last_reject = "SWING_PRO: No EMA 50 breakout aligned with bias"
            return None

        if is_break_up:
            if row.get("rsi", 50) > 60:
                self.last_reject = "SWING_PRO: Breakout too overbought"
                return None
        else:
            if row.get("rsi", 50) < 40:
                self.last_reject = "SWING_PRO: Breakout too oversold"
                return None

        # ROOM TO RUN: reject breakouts that would run straight into the nearest opposing
        # S/R zone. Previously this REQUIRED proximity to S/R, so it bought into resistance
        # / sold into support -- the cause of the 0/8, -8R result. Now we require clearance.
        clearance = config.SL_MAX_DISTANCE_USD
        room_ok = True
        for z in self.sr_zones:
            if is_break_up and z["bottom"] > row["close"] and (z["bottom"] - row["close"]) < clearance:
                room_ok = False
                break
            if is_break_down and z["top"] < row["close"] and (row["close"] - z["top"]) < clearance:
                room_ok = False
                break
        if not room_ok:
            self.last_reject = "SWING_PRO: opposing S/R too close (no room to run)"
            return None

        return self._build_signal(df, idx, row, SWING_PRO, "BUY" if is_break_up else "SELL", bias)

    def _build_signal(self, df: pd.DataFrame, idx: int, row: pd.Series, 
                      strategy: str, direction: str, bias: str) -> Optional[Dict]:
        
        # Stop Loss
        if direction == "BUY":
            sl_anchor = recent_swing_low(df, idx, config.SL_LOOKBACK_BARS, row["close"])
            if sl_anchor is None:
                sl_anchor = row["low"]
            sl = sl_anchor - config.SL_STRUCTURE_BUFFER_USD
            risk_usd = row["close"] - sl
        else:
            sl_anchor = recent_swing_high(df, idx, config.SL_LOOKBACK_BARS, row["close"])
            if sl_anchor is None:
                sl_anchor = row["high"]
            sl = sl_anchor + config.SL_STRUCTURE_BUFFER_USD
            risk_usd = sl - row["close"]

        if risk_usd < config.SL_MIN_DISTANCE_USD:
            sl = row["close"] - config.SL_MIN_DISTANCE_USD if direction == "BUY" else row["close"] + config.SL_MIN_DISTANCE_USD
            risk_usd = config.SL_MIN_DISTANCE_USD
        elif risk_usd > config.SL_MAX_DISTANCE_USD:
            if config.REJECT_SETUP_IF_SL_EXCEEDS_MAX:
                self.last_reject = f"{strategy}: SL too wide (${risk_usd:.2f})"
                return None
            sl = row["close"] - config.SL_MAX_DISTANCE_USD if direction == "BUY" else row["close"] + config.SL_MAX_DISTANCE_USD
            risk_usd = config.SL_MAX_DISTANCE_USD

        # Take Profit
        if direction == "BUY":
            tp1 = row["close"] + (risk_usd * config.TP1_MIN_RR)
            tp2 = tp1 + (risk_usd * config.TP2_MIN_SEPARATION_R)
        else:
            tp1 = row["close"] - (risk_usd * config.TP1_MIN_RR)
            tp2 = tp1 - (risk_usd * config.TP2_MIN_SEPARATION_R)

        # Basic S/R targeting for TP2 if enabled
        if config.SR_USE_AS_TP2:
            sr_zone = nearest_sr(self.sr_zones, tp1, "above" if direction == "BUY" else "below")
            if sr_zone:
                if direction == "BUY" and sr_zone["bottom"] > tp2:
                    tp2 = sr_zone["bottom"]
                elif direction == "SELL" and sr_zone["top"] < tp2:
                    tp2 = sr_zone["top"]

        return {
            "type": direction,
            "strategy": strategy,
            "time": row["time"],
            "entry_price": round(row["close"], config.PRICE_DECIMALS),
            "sl": round(sl, config.PRICE_DECIMALS),
            "tp1": round(tp1, config.PRICE_DECIMALS),
            "tp2": round(tp2, config.PRICE_DECIMALS),
            "bias_direction": bias,
            "risk_usd": round(risk_usd, 3),
            "reasons": [
                f"{bias} macro trend",
                f"RSI Pullback confirmed" if strategy == SWING_CORE else "EMA 50 Breakout",
                f"MACD Momentum crossover" if strategy == SWING_CORE else "S/R Rejection",
            ],
            "poi_source": None,
            "strategy_fingerprint": config.strategy_fingerprint(),
            "session_blocked": False,
            "ctc_sl_price": round(row["close"], config.PRICE_DECIMALS),
            "ctc_trigger_usd": getattr(config, "CTC_MIN_MOVE_USD", 8.0),
            "risk_pips": round(risk_usd / 0.1, 1),
            "tp1_rr": getattr(config, "TP1_MIN_RR", 1.5),
            "tp2_rr": round(abs(tp2 - row["close"]) / risk_usd, 2) if risk_usd > 0 else 0,
            "daily_bias": bias,
            "poi_type": "EMA",
            "rejection_wick_pct": 0.0
        }
