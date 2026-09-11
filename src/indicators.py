"""
MyTradingView - Market Structure & Indicator Engine
===================================================
"""

import bisect
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

import config

# ===========================================================================
# Basic indicators
# ===========================================================================

def calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    tr = pd.concat([
        (df["high"] - df["low"]).abs(),
        (df["high"] - df["close"].shift(1)).abs(),
        (df["low"] - df["close"].shift(1)).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

def calculate_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()

def calculate_rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    delta = df["close"].diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / (avg_loss + 1e-9)
    return 100 - (100 / (1 + rs))

def calculate_macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> Tuple[pd.Series, pd.Series, pd.Series]:
    ema_fast = calculate_ema(df["close"], fast)
    ema_slow = calculate_ema(df["close"], slow)
    macd_line = ema_fast - ema_slow
    signal_line = calculate_ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram

def calculate_bollinger_bands(
    df: pd.DataFrame, period: int = 20, num_std: float = 2.0
) -> Tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    mid = df["close"].rolling(period).mean()
    std = df["close"].rolling(period).std()
    upper = mid + num_std * std
    lower = mid - num_std * std
    width = (upper - lower) / (mid + 1e-9)
    return mid, upper, lower, width

# ===========================================================================
# Structure helpers
# ===========================================================================

def recent_swing_high(df: pd.DataFrame, idx: int, lookback: int, above: float) -> Optional[float]:
    start = max(1, idx - lookback)
    found: List[float] = []
    for i in range(start, idx):
        h = df["high"].iloc[i]
        if h > df["high"].iloc[i - 1] and h > df["high"].iloc[i + 1] and h > above:
            found.append(float(h))
    return min(found) if found else None

def recent_swing_low(df: pd.DataFrame, idx: int, lookback: int, below: float) -> Optional[float]:
    start = max(1, idx - lookback)
    found: List[float] = []
    for i in range(start, idx):
        l = df["low"].iloc[i]
        if l < df["low"].iloc[i - 1] and l < df["low"].iloc[i + 1] and l < below:
            found.append(float(l))
    return max(found) if found else None

def trailing_swing_low(df: pd.DataFrame, idx: int, lookback: int) -> Optional[float]:
    start = max(1, idx - lookback)
    found: List[float] = []
    for i in range(start, idx):
        l = df["low"].iloc[i]
        if l < df["low"].iloc[i - 1] and l < df["low"].iloc[i + 1]:
            found.append(float(l))
    return max(found) if found else None

def trailing_swing_high(df: pd.DataFrame, idx: int, lookback: int) -> Optional[float]:
    start = max(1, idx - lookback)
    found: List[float] = []
    for i in range(start, idx):
        h = df["high"].iloc[i]
        if h > df["high"].iloc[i - 1] and h > df["high"].iloc[i + 1]:
            found.append(float(h))
    return min(found) if found else None

def is_bullish_engulfing(df: pd.DataFrame, idx: int) -> bool:
    if idx < 1:
        return False
    curr = df.iloc[idx]
    prev = df.iloc[idx - 1]
    return (prev["close"] < prev["open"]) and \
           (curr["close"] > curr["open"]) and \
           (curr["close"] > prev["open"]) and \
           (curr["open"] < prev["close"])

def is_bearish_engulfing(df: pd.DataFrame, idx: int) -> bool:
    if idx < 1:
        return False
    curr = df.iloc[idx]
    prev = df.iloc[idx - 1]
    return (prev["close"] > prev["open"]) and \
           (curr["close"] < curr["open"]) and \
           (curr["close"] < prev["open"]) and \
           (curr["open"] > prev["close"])

def is_bullish_pinbar(df: pd.DataFrame, idx: int) -> bool:
    curr = df.iloc[idx]
    body = abs(curr["close"] - curr["open"])
    lower_wick = min(curr["close"], curr["open"]) - curr["low"]
    upper_wick = curr["high"] - max(curr["close"], curr["open"])
    return lower_wick > (body * 2) and upper_wick < body

def is_bearish_pinbar(df: pd.DataFrame, idx: int) -> bool:
    curr = df.iloc[idx]
    body = abs(curr["close"] - curr["open"])
    lower_wick = min(curr["close"], curr["open"]) - curr["low"]
    upper_wick = curr["high"] - max(curr["close"], curr["open"])
    return upper_wick > (body * 2) and lower_wick < body

# ===========================================================================
# Classical support and resistance
# ===========================================================================

def find_pivots(df: pd.DataFrame, left: int = 3, right: int = 3) -> List[Dict]:
    if df is None or len(df) < left + right + 1:
        return []
    hi = df["high"].to_numpy(dtype=float)
    lo = df["low"].to_numpy(dtype=float)
    t = df["time"].to_numpy()
    out: List[Dict] = []
    for i in range(left, len(df) - right):
        wl_h, wr_h = hi[i - left:i], hi[i + 1:i + 1 + right]
        if hi[i] > wl_h.max() and hi[i] > wr_h.max():
            out.append({"kind": "high", "price": float(hi[i]),
                        "time": pd.Timestamp(t[i]),
                        "confirmed_at": pd.Timestamp(t[i + right])})
        wl_l, wr_l = lo[i - left:i], lo[i + 1:i + 1 + right]
        if lo[i] < wl_l.min() and lo[i] < wr_l.min():
            out.append({"kind": "low", "price": float(lo[i]),
                        "time": pd.Timestamp(t[i]),
                        "confirmed_at": pd.Timestamp(t[i + right])})
    return out

def grade_for(strength: float) -> str:
    return "MAJOR" if strength >= 70 else "SOLID" if strength >= 48 else "MINOR"

def detect_sr_zones(df: pd.DataFrame,
                    price: Optional[float] = None,
                    now=None,
                    left: int = None,
                    right: int = None,
                    max_zones: int = None,
                    recent_only: bool = True) -> List[Dict]:
    left = config.SR_PIVOT_LEFT if left is None else left
    right = config.SR_PIVOT_RIGHT if right is None else right
    max_zones = config.SR_MAX_ZONES if max_zones is None else max_zones

    if df is None or len(df) < 30:
        return []

    d = df.reset_index(drop=True).copy()
    d["time"] = pd.to_datetime(d["time"])
    d = d.sort_values("time")

    atr = calculate_atr(d, 14)
    ref_atr = float(atr.dropna().median()) if atr.notna().any() else 1.0
    if not np.isfinite(ref_atr) or ref_atr <= 0:
        ref_atr = max(0.5, float(d["close"].std() or 1.0))

    pivots = find_pivots(d, left, right)
    if now is not None:
        now = pd.Timestamp(now)
        pivots = [p for p in pivots if p["confirmed_at"] < now]
    if len(pivots) < config.SR_MIN_TOUCHES:
        return []

    if recent_only and config.SR_LOOKBACK_BARS and len(d) > config.SR_LOOKBACK_BARS:
        cutoff = d["time"].iloc[-config.SR_LOOKBACK_BARS]
        pivots = [p for p in pivots if p["time"] >= cutoff]

    tol = config.SR_CLUSTER_ATR * ref_atr
    pivots.sort(key=lambda p: p["price"])

    clusters: List[List[Dict]] = []
    for p in pivots:
        if clusters and (p["price"] - clusters[-1][0]["price"]) <= tol:
            clusters[-1].append(p)
        else:
            clusters.append([p])

    last_time = d["time"].iloc[-1]
    last_price = float(d["close"].iloc[-1]) if price is None else float(price)
    span_seconds = max(1.0, (last_time - d["time"].iloc[0]).total_seconds())

    zones: List[Dict] = []
    for c in clusters:
        touches = len(c)
        if touches < config.SR_MIN_TOUCHES:
            continue

        prices = [p["price"] for p in c]
        lo_p, hi_p = min(prices), max(prices)
        pad = max(tol * 0.18, ref_atr * 0.08)
        bottom, top = lo_p - pad, hi_p + pad
        level = float(np.mean(prices))

        first, last = min(p["time"] for p in c), max(p["time"] for p in c)
        persistence = (last - first).total_seconds() / span_seconds
        recency = 1.0 - min(1.0, (last_time - last).total_seconds() / span_seconds)
        kinds = {p["kind"] for p in c}
        flipped = len(kinds) > 1

        base_strength = (
            min(touches, 8) * 12
            + persistence * 22
            + (10 if flipped else 0)
        )
        strength = base_strength + recency * 18

        side = ("RESISTANCE" if level > last_price else "SUPPORT")
        if bottom <= last_price <= top:
            side = "PIVOT"

        zones.append({
            "type": f"SR_{side}",
            "side": side,
            "level": round(level, config.PRICE_DECIMALS),
            "top": round(top, config.PRICE_DECIMALS),
            "bottom": round(bottom, config.PRICE_DECIMALS),
            "touches": touches,
            "highs": sum(1 for p in c if p["kind"] == "high"),
            "lows": sum(1 for p in c if p["kind"] == "low"),
            "flipped": flipped,
            "first_touch": first,
            "last_touch": last,
            "confirmed_at": max(p["confirmed_at"] for p in c),
            "time": first,
            "strength": round(float(strength), 1),
            "base_strength": round(float(base_strength), 1),
            "grade": grade_for(strength),
            "mitigated": False,
            "retests": 0,
        })

    zones.sort(key=lambda z: -z["strength"])
    return zones if not recent_only else zones[:max_zones]

def nearest_sr(zones: List[Dict], price: float, side: str,
               beyond: Optional[float] = None) -> Optional[Dict]:
    if not zones:
        return None
    if side == "above":
        c = [z for z in zones if z["bottom"] > (beyond if beyond is not None else price)]
        return min(c, key=lambda z: z["bottom"]) if c else None
    c = [z for z in zones if z["top"] < (beyond if beyond is not None else price)]
    return max(c, key=lambda z: z["top"]) if c else None

def resample_ohlc(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    if df is None or len(df) < 2:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close"])
    d = df.copy()
    d["time"] = pd.to_datetime(d["time"])
    d = d.sort_values("time")
    first, last = d["time"].iloc[0], d["time"].iloc[-1]

    out = (d.set_index("time")
             .resample(rule, label="right", closed="right")
             .agg({"open": "first", "high": "max", "low": "min", "close": "last"})
             .dropna()
             .reset_index())

    step = pd.tseries.frequencies.to_offset(rule)
    out = out[out["time"] <= last]
    if len(out) and (out["time"].iloc[0] - step) < first:
        out = out.iloc[1:]
    return out.reset_index(drop=True)

def prepare_dataframe(
    df_ltf: pd.DataFrame, df_itf: pd.DataFrame, df_htf: pd.DataFrame
) -> pd.DataFrame:
    if df_ltf is None or df_ltf.empty:
        return df_ltf
    
    # Calculate Macro Trend (200 EMA) on HTF
    if df_htf is not None and not df_htf.empty:
        df_htf["ema_200"] = calculate_ema(df_htf["close"], 200)
        df_htf["ema_50"] = calculate_ema(df_htf["close"], 50)
    
    # Calculate Momentum (MACD) and Pullbacks (RSI) on ITF
    if df_itf is not None and not df_itf.empty:
        df_itf["rsi"] = calculate_rsi(df_itf, config.RSI_PERIOD)
        df_itf["macd"], df_itf["macd_signal"], df_itf["macd_hist"] = calculate_macd(
            df_itf, config.MACD_FAST, config.MACD_SLOW, config.MACD_SIGNAL
        )

    # Attach all calculations to LTF for evaluation
    d = df_ltf.copy()
    d["time"] = pd.to_datetime(d["time"])
    d = d.sort_values("time")

    # Basic LTF indicators
    d["atr"] = calculate_atr(d, 14)
    d["ema_50"] = calculate_ema(d["close"], 50)

    # Candlestick triggers
    d["bullish_engulfing"] = [is_bullish_engulfing(d, i) for i in range(len(d))]
    d["bearish_engulfing"] = [is_bearish_engulfing(d, i) for i in range(len(d))]
    d["bullish_pinbar"] = [is_bullish_pinbar(d, i) for i in range(len(d))]
    d["bearish_pinbar"] = [is_bearish_pinbar(d, i) for i in range(len(d))]

    if df_htf is not None and not df_htf.empty:
        htf = df_htf.copy()
        htf["time"] = pd.to_datetime(htf["time"])
        htf = htf.sort_values("time")
        # As-of merge to get latest completed HTF close/ema
        htf = htf.rename(columns={"close": "close_htf", "ema_200": "ema_200_htf", "ema_50": "ema_50_htf"})
        d = pd.merge_asof(d, htf[["time", "close_htf", "ema_200_htf", "ema_50_htf"]], on="time")

    if df_itf is not None and not df_itf.empty:
        itf = df_itf.copy()
        itf["time"] = pd.to_datetime(itf["time"])
        itf = itf.sort_values("time")
        d = pd.merge_asof(d, itf[["time", "rsi", "macd", "macd_signal", "macd_hist"]], on="time")
    
    # Track lowest RSI looking back a few bars on ITF to confirm pullback
    if "rsi" in d.columns:
        d["rsi_min_lookback"] = d["rsi"].rolling(10).min()
        d["rsi_max_lookback"] = d["rsi"].rolling(10).max()

    return d
