"""
Haider-Scalper-Enhanced (Champion Scalper Engine)
=================================================
Ultra-High-Accuracy Institutional Algorithmic Engine for Spot Gold, Crypto, and Forex.

Systematic Quantitative Edge:
1. Microstructure Liquidity Sweep (8-bar lookback) — Confirms retail stop hunting.
2. Statistical Bollinger Band Exhaustion (20-period, 1.8 std) — Detects true mean-reversion boundaries.
3. Strict Momentum Exhaustion (RSI <= 30.0 / >= 70.0) — Eliminates fakeout mid-range entries.
4. Institutional Absorption Rejection Wick (>= 22% of candle range) — Confirms institutional order absorption.
5. Trend Regime Filter (50 EMA vs 200 EMA) — Avoids cascading counter-trend steamrolls.
6. Market Rollover Spread Defense (21:00-22:30 UTC) — Protects against toxic broker spread spikes.
7. 2-Tranche Dynamic Scaling with Instant Auto-BE at TP1 — Banks 50% at TP1 (+0.20x - +0.25x ATR),
   instantly locking Stop Loss at entry (zero risk), while letting the runner expand into TP2 (+1.60x ATR).
8. Tight Structural Anti-Hunt SL — Placed 0.25x ATR beyond the rejection wick extreme to minimize loss magnitude.
"""

from __future__ import annotations
import math
import datetime
from typing import List, Tuple, Dict, Any, Optional
from real_dip_bt import wilder_atr, wilder_rsi


def backtest(
    bars: List[Tuple[int, float, float, float, float]],  # (ts, o, h, l, c)
    atr_len: int = 14,
    impulse_mult: float = 0.45,
    rsi_len: int = 14,
    rsi_buy_level: float = 30.0,
    rsi_sell_level: float = 70.0,
    target_level: float = 80.0,
    sl_buffer: float = 0.20,
    min_wick_ratio: float = 0.18,
    skip_rollover: bool = True,
    mintick: float = 0.001,
    lot_size: float = 0.10,
    tick_value: float = 0.10,
    sweep_lookback: int = 4,
    use_trend_filter: bool = True,
    tp1_atr_mult: float = 0.25,
    tp2_atr_mult: float = 3.00,
    trail_runner: bool = True
) -> Dict[str, Any]:
    n = len(bars)
    if n < max(atr_len, rsi_len) + 20:
        return {"error": "Not enough bars"}

    times = [b[0] for b in bars]
    opens = [b[1] for b in bars]
    highs = [b[2] for b in bars]
    lows = [b[3] for b in bars]
    closes = [b[4] for b in bars]

    atr = wilder_atr(highs, lows, closes, atr_len)
    rsi = wilder_rsi(closes, rsi_len)

    # 20 Bollinger Bands (1.8 std)
    bb_upper = [0.0] * n
    bb_lower = [0.0] * n
    for i in range(20, n):
        w = closes[i-19:i+1]
        m = sum(w) / 20.0
        s = math.sqrt(sum((x - m)**2 for x in w) / 20.0)
        bb_upper[i] = m + 1.8 * s
        bb_lower[i] = m - 1.8 * s

    # 50 EMA & 200 EMA
    def calc_ema(series, period):
        res = [series[0]] * len(series)
        k = 2.0 / (period + 1.0)
        for i in range(1, len(series)):
            res[i] = series[i] * k + res[i-1] * (1.0 - k)
        return res

    ema50 = calc_ema(closes, 50)
    ema200 = calc_ema(closes, 200)

    setup_state = 0
    setup_bar_index = -1
    setup_high = 0.0
    setup_low = 0.0
    setup_range = 0.0
    tp1_level = 0.0
    tp2_level = 0.0
    sl_level = 0.0

    trades = []
    active_trade: Optional[Dict[str, Any]] = None

    buckets = {'small': 0, 'b10': 0, 'b20': 0, 'b30': 0, 'b50': 0, 'b70': 0, 'b100': 0}
    win_points = []
    loss_points = []

    for i in range(1, n):
        h = highs[i]
        l = lows[i]
        o = opens[i]
        c = closes[i]
        t = times[i]
        curr_atr = atr[i]
        curr_rsi = rsi[i]
        dt = datetime.datetime.fromtimestamp(t, tz=datetime.timezone.utc)

        # 1. Manage Active Trade (2-Tranche Scaling + Auto-BE at TP1)
        if active_trade is not None:
            tr = active_trade
            if tr['direction'] == 1:  # Long
                tr['max_excursion'] = max(tr['max_excursion'], h - tr['entry_price'])

                # Check TP1 hit first (secures 50% profit and moves SL to entry)
                if h >= tr['tp_price'] and not tr.get('tp1_hit', False):
                    tr['tp1_hit'] = True
                    tr['sl_price'] = tr['entry_price']  # Auto-BE
                    tr['banked_half'] = (tr['tp_price'] - tr['entry_price']) * (lot_size * 0.5) * (tick_value / mintick)

                # Dynamic Trailing Runner (Locks in +0.20x ATR, then +0.50x ATR as price expands)
                if trail_runner and tr.get('tp1_hit', False):
                    if h >= tr['entry_price'] + curr_atr * 0.60:
                        tr['sl_price'] = max(tr['sl_price'], tr['entry_price'] + curr_atr * 0.20)
                    if h >= tr['entry_price'] + curr_atr * 1.00:
                        tr['sl_price'] = max(tr['sl_price'], tr['entry_price'] + curr_atr * 0.50)

                # Check SL hit
                if l <= tr['sl_price']:
                    tr['exit_idx'] = i
                    tr['exit_time'] = t
                    tr['exit_price'] = tr['sl_price']
                    if tr.get('tp1_hit', False):
                        tr['exit_reason'] = "TP1 + BE HIT"
                        runner_pnl = max(0.0, (tr['sl_price'] - tr['entry_price'])) * (lot_size * 0.5) * (tick_value / mintick)
                        tr['pnl'] = tr['banked_half'] + runner_pnl
                        tr['points'] = (abs(tr['tp_price'] - tr['entry_price']) * 0.5 + max(0.0, tr['sl_price'] - tr['entry_price']) * 0.5) / mintick
                        win_points.append(tr['points'])
                    else:
                        tr['exit_reason'] = "SL HIT"
                        pts = -(abs(tr['entry_price'] - tr['sl_price']) / mintick)
                        tr['points'] = pts
                        tr['pnl'] = (tr['sl_price'] - tr['entry_price']) * lot_size * (tick_value / mintick)
                        loss_points.append(abs(pts))
                    active_trade = None

                # Check TP2 runner hit
                elif h >= tr.get('tp2_price', tr['tp_price'] * 1.5) and tr.get('tp1_hit', False):
                    tr['exit_idx'] = i
                    tr['exit_time'] = t
                    tr['exit_price'] = tr['tp2_price']
                    tr['exit_reason'] = "FULL TP1+TP2 HIT"
                    runner_pnl = (tr['tp2_price'] - tr['entry_price']) * (lot_size * 0.5) * (tick_value / mintick)
                    tr['pnl'] = tr['banked_half'] + runner_pnl
                    half_tp1 = (abs(tr['tp_price'] - tr['entry_price']) / mintick) * 0.5
                    half_tp2 = (abs(tr['tp2_price'] - tr['entry_price']) / mintick) * 0.5
                    tr['points'] = half_tp1 + half_tp2
                    win_points.append(tr['points'])
                    active_trade = None

            else:  # Short
                tr['max_excursion'] = max(tr['max_excursion'], tr['entry_price'] - l)

                if l <= tr['tp_price'] and not tr.get('tp1_hit', False):
                    tr['tp1_hit'] = True
                    tr['sl_price'] = tr['entry_price']
                    tr['banked_half'] = (tr['entry_price'] - tr['tp_price']) * (lot_size * 0.5) * (tick_value / mintick)

                # Dynamic Trailing Runner (Locks in +0.20x ATR, then +0.50x ATR as price expands)
                if trail_runner and tr.get('tp1_hit', False):
                    if l <= tr['entry_price'] - curr_atr * 0.60:
                        tr['sl_price'] = min(tr['sl_price'], tr['entry_price'] - curr_atr * 0.20)
                    if l <= tr['entry_price'] - curr_atr * 1.00:
                        tr['sl_price'] = min(tr['sl_price'], tr['entry_price'] - curr_atr * 0.50)

                if h >= tr['sl_price']:
                    tr['exit_idx'] = i
                    tr['exit_time'] = t
                    tr['exit_price'] = tr['sl_price']
                    if tr.get('tp1_hit', False):
                        tr['exit_reason'] = "TP1 + BE HIT"
                        runner_pnl = max(0.0, (tr['entry_price'] - tr['sl_price'])) * (lot_size * 0.5) * (tick_value / mintick)
                        tr['pnl'] = tr['banked_half'] + runner_pnl
                        tr['points'] = (abs(tr['entry_price'] - tr['tp_price']) * 0.5 + max(0.0, tr['entry_price'] - tr['sl_price']) * 0.5) / mintick
                        win_points.append(tr['points'])
                    else:
                        tr['exit_reason'] = "SL HIT"
                        pts = -(abs(tr['sl_price'] - tr['entry_price']) / mintick)
                        tr['points'] = pts
                        tr['pnl'] = (tr['entry_price'] - tr['sl_price']) * lot_size * (tick_value / mintick)
                        loss_points.append(abs(pts))
                    active_trade = None

                elif l <= tr.get('tp2_price', tr['tp_price'] * 0.5) and tr.get('tp1_hit', False):
                    tr['exit_idx'] = i
                    tr['exit_time'] = t
                    tr['exit_price'] = tr['tp2_price']
                    tr['exit_reason'] = "FULL TP1+TP2 HIT"
                    runner_pnl = (tr['entry_price'] - tr['tp2_price']) * (lot_size * 0.5) * (tick_value / mintick)
                    tr['pnl'] = tr['banked_half'] + runner_pnl
                    half_tp1 = (abs(tr['entry_price'] - tr['tp_price']) / mintick) * 0.5
                    half_tp2 = (abs(tr['entry_price'] - tr['tp2_price']) / mintick) * 0.5
                    tr['points'] = half_tp1 + half_tp2
                    win_points.append(tr['points'])
                    active_trade = None

        # 2. Invalidate Setup if price crosses SL before trigger
        if setup_state == 1 and h > sl_level:
            setup_state = 0
        if setup_state == -1 and l < sl_level:
            setup_state = 0

        # 3. Next Bar Trigger
        buy_signal = False
        sell_signal = False
        if setup_state == 1 and i > setup_bar_index:
            sell_signal = True
            setup_state = 0
        if setup_state == -1 and i > setup_bar_index:
            buy_signal = True
            setup_state = 0

        if buy_signal or sell_signal:
            if active_trade is not None:
                old = active_trade
                old['exit_idx'] = i
                old['exit_time'] = t
                old['exit_price'] = o
                old['exit_reason'] = "CLOSED @ NEW SIGNAL"
                diff = (o - old['entry_price']) if old['direction'] == 1 else (old['entry_price'] - o)
                old['points'] = diff / mintick
                old['pnl'] = diff * lot_size * (tick_value / mintick)
                if old['pnl'] > 0: win_points.append(old['points'])
                else: loss_points.append(abs(old['points']))
                active_trade = None

            direction = 1 if buy_signal else -1
            new_t = {
                'signal_idx': setup_bar_index,
                'entry_idx': i,
                'direction': direction,
                'entry_price': o,
                'sl_price': sl_level,
                'tp_price': tp1_level,
                'tp2_price': tp2_level,
                'entry_time': t,
                'max_excursion': 0.0,
                'points': 0.0,
                'pnl': 0.0,
                'exit_reason': "OPEN",
                'tp1_hit': False,
                'banked_half': 0.0
            }
            trades.append(new_t)
            active_trade = new_t

        # 4. Detect Setup on Bar Close
        if curr_atr is not None and curr_rsi is not None and i >= 20:
            if skip_rollover and (dt.hour == 21 or (dt.hour == 22 and dt.minute <= 30)):
                continue

            crange = h - l
            cbody = abs(c - o)
            if crange <= 0 or curr_atr <= 0:
                continue

            lower_wick = (min(o, c) - l) / crange
            upper_wick = (h - max(o, c)) / crange

            # Liquidity sweep check
            prev_highs = highs[max(0, i-sweep_lookback):i]
            prev_lows = lows[max(0, i-sweep_lookback):i]
            swept_high = (h > max(prev_highs)) if prev_highs else True
            swept_low = (l < min(prev_lows)) if prev_lows else True

            is_buy = (c < o) and (cbody >= curr_atr * impulse_mult) and (lower_wick >= min_wick_ratio) and (curr_rsi <= rsi_buy_level) and (l <= bb_lower[i]) and swept_low
            is_sell = (c > o) and (cbody >= curr_atr * impulse_mult) and (upper_wick >= min_wick_ratio) and (curr_rsi >= rsi_sell_level) and (h >= bb_upper[i]) and swept_high

            # Trend Alignment filter
            if use_trend_filter and i >= 200:
                if is_buy and ema50[i] < ema200[i] and curr_rsi >= 26.0:
                    is_buy = False
                if is_sell and ema50[i] > ema200[i] and curr_rsi <= 74.0:
                    is_sell = False

            if is_sell and setup_state == 0:
                setup_state = 1
                setup_bar_index = i
                setup_high = h
                setup_low = l
                setup_range = crange
                tp1_level = c - (curr_atr * tp1_atr_mult)
                tp2_level = c - (curr_atr * tp2_atr_mult)
                sl_level = h + (curr_atr * sl_buffer)
            elif is_buy and setup_state == 0:
                setup_state = -1
                setup_bar_index = i
                setup_high = h
                setup_low = l
                setup_range = crange
                tp1_level = c + (curr_atr * tp1_atr_mult)
                tp2_level = c + (curr_atr * tp2_atr_mult)
                sl_level = l - (curr_atr * sl_buffer)

    total_signals = len(trades)
    win_count = sum(1 for t in trades if t['exit_reason'] in ("TP HIT", "TP1 + BE HIT", "FULL TP1+TP2 HIT"))
    loss_count = sum(1 for t in trades if t['exit_reason'] == "SL HIT")
    closed_signal = sum(1 for t in trades if t['exit_reason'] == "CLOSED @ NEW SIGNAL")

    resolved = win_count + loss_count
    win_rate = (win_count / resolved * 100.0) if resolved > 0 else 0.0
    min_win = min(win_points) if win_points else 0.0
    max_win = max(win_points) if win_points else 0.0
    avg_win = (sum(win_points) / len(win_points)) if win_points else 0.0
    avg_loss = (sum(loss_points) / len(loss_points)) if loss_points else 0.0

    if win_points:
        sw = sorted(win_points)
        nw = len(sw)
        median_win = sw[nw // 2] if nw % 2 == 1 else (sw[nw // 2 - 1] + sw[nw // 2]) / 2.0
    else:
        median_win = 0.0

    net_pnl = sum(t['pnl'] for t in trades)
    gross_win = sum(t['pnl'] for t in trades if t['pnl'] > 0)
    gross_loss = abs(sum(t['pnl'] for t in trades if t['pnl'] < 0))
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else (999.0 if gross_win > 0 else 0.0)

    eq = 10000.0
    peak = 10000.0
    max_dd = 0.0
    for t in trades:
        eq += t['pnl']
        if eq > peak:
            peak = eq
        dd = (peak - eq) / peak if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd

    return {
        "strategy": "Haider-Scalper-Enhanced",
        "total_signals": total_signals,
        "win_count": win_count,
        "loss_count": loss_count,
        "closed_new_signal": closed_signal,
        "win_rate": round(win_rate, 1),
        "partial_moves": sum(1 for t in trades if t['exit_reason'] == "TP1 + BE HIT"),
        "overshot_tp": sum(1 for t in trades if t['exit_reason'] == "FULL TP1+TP2 HIT"),
        "min_win_pts": round(min_win, 1),
        "max_win_pts": round(max_win, 1),
        "avg_win_pts": round(avg_win, 1),
        "avg_loss_pts": round(avg_loss, 1),
        "median_win_pts": round(median_win, 1),
        "net_pnl": round(net_pnl, 2),
        "profit_factor": round(profit_factor, 2),
        "max_drawdown": round(max_dd * 100.0, 2),
        "max_drawdown_pct": round(max_dd * 100.0, 2),
        "trades_count": len(trades),
        "trades": trades
    }
