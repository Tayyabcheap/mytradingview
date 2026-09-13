"""
Haider-Gold-Scalper [SL Buffer] backtest engine.
Shared by /api/backtest/haider_gold_scalper and /api/backtest/real_dip endpoints, CLI tool, and strategy evaluations.
Replicates the user's Pine Script v6:
  - Big Candle Detection: candleBody > atr * impulseMult
  - RSI Exhaustion Filter: Buy: close < open & rsi < 35; Sell: close > open & rsi > 65
  - TP: 50% retracement of impulse candle range
  - SL: Low/High +/- (atr * slBuffer)
  - Enters on next bar OPEN
  - Tracks Intrabar TP/SL, Excursion Buckets, and Win Stats
"""
from __future__ import annotations
import math
from typing import List, Tuple, Dict, Any, Optional


def rma(src: List[float], length: int) -> List[Optional[float]]:
    n = len(src)
    out: List[Optional[float]] = [None] * n
    alpha = 1.0 / length
    sum_seed = 0.0
    count = 0
    prev: Optional[float] = None
    for i in range(n):
        x = src[i]
        if x is None or math.isnan(x):
            out[i] = prev
            continue
        if prev is None:
            sum_seed += x
            count += 1
            if count == length:
                prev = sum_seed / length
                out[i] = prev
            else:
                out[i] = None
        else:
            prev = alpha * x + (1.0 - alpha) * prev
            out[i] = prev
    return out


def wilder_rsi(closes: List[float], length: int = 14) -> List[Optional[float]]:
    n = len(closes)
    if n < length + 1:
        return [None] * n
    gains = [0.0] * n
    losses = [0.0] * n
    for i in range(1, n):
        ch = closes[i] - closes[i - 1]
        if ch > 0:
            gains[i] = ch
        elif ch < 0:
            losses[i] = -ch

    avg_gain = rma(gains, length)
    avg_loss = rma(losses, length)

    rsi: List[Optional[float]] = [None] * n
    for i in range(n):
        ag = avg_gain[i]
        al = avg_loss[i]
        if ag is None or al is None:
            continue
        if al == 0.0:
            rsi[i] = 100.0 if ag > 0 else 50.0
        else:
            rs = ag / al
            rsi[i] = 100.0 - (100.0 / (1.0 + rs))
    return rsi


def wilder_atr(highs: List[float], lows: List[float], closes: List[float], length: int = 14) -> List[Optional[float]]:
    n = len(closes)
    tr: List[float] = [0.0] * n
    for i in range(n):
        h = highs[i]
        l = lows[i]
        if i == 0:
            tr[i] = h - l
        else:
            pc = closes[i - 1]
            tr[i] = max(h - l, abs(h - pc), abs(l - pc))
    return rma(tr, length)


def backtest(
    bars: List[Tuple[int, float, float, float, float]],  # (ts, o, h, l, c)
    atr_len: int = 14,
    impulse_mult: float = 1.0,
    rsi_len: int = 14,
    rsi_buy_level: float = 35.0,
    rsi_sell_level: float = 65.0,
    target_level: float = 50.0,
    sl_buffer: float = 1.0,
    mintick: float = 0.01,
    lot_size: float = 0.10,
    tick_value: float = 1.0
) -> Dict[str, Any]:
    n = len(bars)
    if n < max(atr_len, rsi_len) + 5:
        return {"error": "Not enough bars"}

    times = [b[0] for b in bars]
    opens = [b[1] for b in bars]
    highs = [b[2] for b in bars]
    lows = [b[3] for b in bars]
    closes = [b[4] for b in bars]

    atr = wilder_atr(highs, lows, closes, atr_len)
    rsi = wilder_rsi(closes, rsi_len)

    setup_state = 0
    setup_bar_index = -1
    setup_high = 0.0
    setup_low = 0.0
    setup_range = 0.0
    tp_level = 0.0
    sl_level = 0.0

    trades = []
    active_trade: Optional[Dict[str, Any]] = None

    buckets = {'small': 0, 'b10': 0, 'b20': 0, 'b30': 0, 'b50': 0, 'b70': 0, 'b100': 0}
    win_points = []

    for i in range(1, n):
        h = highs[i]
        l = lows[i]
        o = opens[i]
        c = closes[i]
        t = times[i]
        curr_atr = atr[i]
        curr_rsi = rsi[i]

        # 1. Manage Active Trade
        if active_trade is not None:
            tr = active_trade
            if tr['direction'] == 1:  # Long
                tr['max_excursion'] = max(tr['max_excursion'], h - tr['entry_price'])
                if l <= tr['sl_price']:
                    tr['exit_idx'] = i
                    tr['exit_time'] = t
                    tr['exit_price'] = tr['sl_price']
                    tr['exit_reason'] = "SL HIT"
                    tr['points'] = -(abs(tr['sl_price'] - tr['entry_price']) / mintick)
                    tr['pnl'] = (tr['sl_price'] - tr['entry_price']) * lot_size * (tick_value / mintick)
                    active_trade = None
                elif h >= tr['tp_price']:
                    tr['exit_idx'] = i
                    tr['exit_time'] = t
                    tr['exit_price'] = tr['tp_price']
                    tr['exit_reason'] = "TP HIT"
                    tr['points'] = abs(tr['tp_price'] - tr['entry_price']) / mintick
                    tr['pnl'] = (tr['tp_price'] - tr['entry_price']) * lot_size * (tick_value / mintick)
                    win_points.append(tr['points'])
                    active_trade = None
            else:  # Short
                tr['max_excursion'] = max(tr['max_excursion'], tr['entry_price'] - l)
                if h >= tr['sl_price']:
                    tr['exit_idx'] = i
                    tr['exit_time'] = t
                    tr['exit_price'] = tr['sl_price']
                    tr['exit_reason'] = "SL HIT"
                    tr['points'] = -(abs(tr['sl_price'] - tr['entry_price']) / mintick)
                    tr['pnl'] = (tr['entry_price'] - tr['sl_price']) * lot_size * (tick_value / mintick)
                    active_trade = None
                elif l <= tr['tp_price']:
                    tr['exit_idx'] = i
                    tr['exit_time'] = t
                    tr['exit_price'] = tr['tp_price']
                    tr['exit_reason'] = "TP HIT"
                    tr['points'] = abs(tr['tp_price'] - tr['entry_price']) / mintick
                    tr['pnl'] = (tr['entry_price'] - tr['tp_price']) * lot_size * (tick_value / mintick)
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
                if old['trade_range'] > 0:
                    pct = (old['max_excursion'] / old['trade_range']) * 100.0
                    if pct >= 100: buckets['b100'] += 1
                    elif pct >= 70: buckets['b70'] += 1
                    elif pct >= 50: buckets['b50'] += 1
                    elif pct >= 30: buckets['b30'] += 1
                    elif pct >= 20: buckets['b20'] += 1
                    elif pct >= 10: buckets['b10'] += 1
                    else: buckets['small'] += 1
                active_trade = None

            direction = 1 if buy_signal else -1
            t_range = abs(tp_level - o)
            new_t = {
                'signal_idx': setup_bar_index,
                'entry_idx': i,
                'direction': direction,
                'entry_price': o,
                'sl_price': sl_level,
                'tp_price': tp_level,
                'trade_range': t_range,
                'entry_time': t,
                'max_excursion': 0.0,
                'points': 0.0,
                'pnl': 0.0,
                'exit_reason': "OPEN"
            }
            trades.append(new_t)
            active_trade = new_t

        # 4. Detect Setup on Bar Close
        if curr_atr is not None and curr_rsi is not None:
            cbody = abs(c - o)
            crange = h - l
            is_buy = (c < o) and (cbody > curr_atr * impulse_mult) and (curr_rsi < rsi_buy_level)
            is_sell = (c > o) and (cbody > curr_atr * impulse_mult) and (curr_rsi > rsi_sell_level)

            if is_sell and setup_state == 0:
                setup_state = 1
                setup_bar_index = i
                setup_high = h
                setup_low = l
                setup_range = crange
                tp_level = setup_high - (setup_range * (target_level / 100.0))
                sl_level = setup_high + (curr_atr * sl_buffer)
            elif is_buy and setup_state == 0:
                setup_state = -1
                setup_bar_index = i
                setup_high = h
                setup_low = l
                setup_range = crange
                tp_level = setup_low + (setup_range * (target_level / 100.0))
                sl_level = setup_low - (curr_atr * sl_buffer)

    total_signals = len(trades)
    win_count = sum(1 for t in trades if t['exit_reason'] == "TP HIT")
    loss_count = sum(1 for t in trades if t['exit_reason'] == "SL HIT")
    closed_signal = sum(1 for t in trades if t['exit_reason'] == "CLOSED @ NEW SIGNAL")

    win_rate = (win_count / total_signals * 100.0) if total_signals > 0 else 0.0
    min_win = min(win_points) if win_points else 0.0
    max_win = max(win_points) if win_points else 0.0
    avg_win = (sum(win_points) / len(win_points)) if win_points else 0.0

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
        "strategy": "Haider-Gold-Scalper [SL Buffer]",
        "total_signals": total_signals,
        "win_count": win_count,
        "loss_count": loss_count,
        "closed_new_signal": closed_signal,
        "win_rate": round(win_rate, 1),
        "partial_moves": buckets['b10'] + buckets['b20'] + buckets['b30'],
        "overshot_tp": buckets['b50'] + buckets['b70'] + buckets['b100'],
        "min_win_pts": round(min_win, 1),
        "max_win_pts": round(max_win, 1),
        "avg_win_pts": round(avg_win, 1),
        "median_win_pts": round(median_win, 1),
        "net_pnl": round(net_pnl, 2),
        "profit_factor": round(profit_factor, 2),
        "max_drawdown_pct": round(max_dd * 100.0, 2),
        "trades_count": len(trades),
        "trades": trades
    }
