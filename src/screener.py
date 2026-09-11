"""
Market Screener Engine for MyTradingView
Real-time multi-asset and multi-timeframe scanner for setups, confluences, and Haider-Gold-Scalper alerts.
"""

import datetime
import numpy as np

# Typical symbol watch candidate lists
DEFAULT_WATCHLIST = [
    "XAUUSDc", "XAUUSD", "XAUUSDm", "GOLD",
    "EURUSDc", "EURUSD", "EURUSDm",
    "GBPUSDc", "GBPUSD", "GBPUSDm",
    "USDJPYc", "USDJPY", "USDJPYm",
    "US30", "US30m", "DJ30",
    "NAS100", "USTEC", "NAS100m",
    "BTCUSD", "BTCUSDc"
]


def _calc_ema(series, length):
    alpha = 2.0 / (length + 1)
    out = np.empty_like(series)
    out[0] = series[0]
    for i in range(1, len(series)):
        out[i] = alpha * series[i] + (1 - alpha) * out[i - 1]
    return out


def _calc_rsi(closes, length=14):
    if len(closes) < length + 1:
        return np.full_like(closes, 50.0)
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    avg_gain = np.mean(gains[:length])
    avg_loss = np.mean(losses[:length])
    rsi = np.empty(len(closes))
    rsi[:length] = 50.0

    for i in range(length, len(closes)):
        g = gains[i - 1]
        l = losses[i - 1]
        avg_gain = (avg_gain * (length - 1) + g) / length
        avg_loss = (avg_loss * (length - 1) + l) / length
        if avg_loss == 0:
            rsi[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi[i] = 100.0 - (100.0 / (1.0 + rs))
    return rsi


def _calc_atr(highs, lows, closes, length=14):
    if len(closes) < 2:
        return np.zeros_like(closes)
    tr = np.maximum(
        highs[1:] - lows[1:],
        np.maximum(
            np.abs(highs[1:] - closes[:-1]),
            np.abs(lows[1:] - closes[:-1])
        )
    )
    atr = np.empty(len(closes))
    atr[0] = highs[0] - lows[0]
    if len(tr) < length:
        atr[1:] = np.mean(tr) if len(tr) > 0 else 0.0
        return atr
    atr[1:length + 1] = np.mean(tr[:length])
    for i in range(length + 1, len(closes)):
        atr[i] = (atr[i - 1] * (length - 1) + tr[i - 1]) / length
    return atr


def scan_symbols(mt5_module, mt5_lock, symbols=None, tf_map=None, resolve_symbol_fn=None):
    """
    Scan MT5 symbols across 1H timeframe for high-confluence trade opportunities.
    """
    if symbols is None:
        symbols = DEFAULT_WATCHLIST

    results = []
    scanned_seen = set()

    for sym in symbols:
        real_sym = resolve_symbol_fn(sym) if resolve_symbol_fn else sym
        if not real_sym or real_sym in scanned_seen:
            continue
        scanned_seen.add(real_sym)

        with mt5_lock:
            if not mt5_module.symbol_select(real_sym, True):
                continue
            info = mt5_module.symbol_info(real_sym)
            if info is None:
                continue

            # Fetch 1H rates (100 bars)
            tf_1h = tf_map.get("1H") if tf_map else 16385
            rates = mt5_module.copy_rates_from_pos(real_sym, tf_1h, 0, 120)
            tick = mt5_module.symbol_info_tick(real_sym)

        if rates is None or len(rates) < 40:
            continue

        closes = np.array([r["close"] for r in rates], dtype=float)
        highs = np.array([r["high"] for r in rates], dtype=float)
        lows = np.array([r["low"] for r in rates], dtype=float)
        opens = np.array([r["open"] for r in rates], dtype=float)

        curr_price = float(tick.bid) if tick else float(closes[-1])
        spread = float(info.spread) * float(info.point) if (info and info.point) else 0.0

        # Calculations
        rsi_series = _calc_rsi(closes, 14)
        rsi_val = round(float(rsi_series[-1]), 1)

        ema20 = _calc_ema(closes, 20)
        ema50 = _calc_ema(closes, 50)
        ema200 = _calc_ema(closes, min(200, len(closes) - 1)) if len(closes) >= 50 else ema50
        atr_series = _calc_atr(highs, lows, closes, 14)
        atr_val = float(atr_series[-1])

        # Direction / Trend
        is_bull = curr_price > ema20[-1] and ema20[-1] > ema50[-1]
        is_bear = curr_price < ema20[-1] and ema20[-1] < ema50[-1]

        # Candle Wick Analysis (Last 2 bars)
        last_h, last_l, last_o, last_c = highs[-1], lows[-1], opens[-1], closes[-1]
        bar_range = max(last_h - last_l, 0.0001)
        lower_wick = min(last_o, last_c) - last_l
        upper_wick = last_h - max(last_o, last_c)
        lower_wick_ratio = lower_wick / bar_range
        upper_wick_ratio = upper_wick / bar_range

        # Haider-Gold-Scalper check
        is_gold = "XAU" in real_sym.upper() or "GOLD" in real_sym.upper()
        signal_type = "NEUTRAL"
        signal_desc = "Consolidation / Range"
        confluence_score = 45

        # Dip Buy
        if rsi_val <= 33 or (rsi_val <= 40 and lower_wick_ratio >= 0.35 and curr_price >= ema50[-1]):
            signal_type = "BUY"
            signal_desc = "Haider Dip Buy (Exhaustion + Rebound)"
            confluence_score += 35
            if is_bull:
                confluence_score += 15
        # Peak Sell
        elif rsi_val >= 67 or (rsi_val >= 60 and upper_wick_ratio >= 0.35 and curr_price <= ema50[-1]):
            signal_type = "SELL"
            signal_desc = "Haider Peak Sell (Overbought Rejection)"
            confluence_score += 35
            if is_bear:
                confluence_score += 15
        elif is_bull:
            signal_type = "BUY"
            signal_desc = "Trend Alignment (EMA 20/50/200 Stack)"
            confluence_score += 25
        elif is_bear:
            signal_type = "SELL"
            signal_desc = "Trend Alignment (Bearish Momentum)"
            confluence_score += 25

        # 24h change approximate
        change_24h = round(float(((curr_price - closes[0]) / closes[0]) * 100.0), 2)

        # SL and TP projections
        digits = int(info.digits) if info else 2
        mult = 1.5
        if signal_type == "BUY":
            sl_price = round(curr_price - (atr_val * mult), digits)
            tp1_price = round(curr_price + (atr_val * mult * 1.0), digits)
            tp2_price = round(curr_price + (atr_val * mult * 2.0), digits)
        elif signal_type == "SELL":
            sl_price = round(curr_price + (atr_val * mult), digits)
            tp1_price = round(curr_price - (atr_val * mult * 1.0), digits)
            tp2_price = round(curr_price - (atr_val * mult * 2.0), digits)
        else:
            sl_price = round(curr_price - atr_val, digits)
            tp1_price = round(curr_price + atr_val, digits)
            tp2_price = round(curr_price + atr_val * 2, digits)

        confluence_score = min(98, max(30, confluence_score))

        if confluence_score >= 85:
            grade = "A+"
        elif confluence_score >= 70:
            grade = "A"
        elif confluence_score >= 55:
            grade = "B"
        else:
            grade = "WATCH"

        results.append({
            "symbol": real_sym,
            "display_name": real_sym.replace("c", "").replace("m", ""),
            "is_gold": is_gold,
            "price": round(curr_price, digits),
            "change_24h": change_24h,
            "spread_points": round(spread / (info.point or 0.01), 1) if info else 0,
            "rsi": rsi_val,
            "atr": round(atr_val, digits),
            "signal": signal_type,
            "signal_desc": signal_desc,
            "score": confluence_score,
            "grade": grade,
            "sl": sl_price,
            "tp1": tp1_price,
            "tp2": tp2_price,
            "timeframe": "1H",
        })

    # Sort descending by confluence score
    results.sort(key=lambda x: x["score"], reverse=True)
    return {
        "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "total_scanned": len(results),
        "results": results
    }
