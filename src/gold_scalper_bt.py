"""
Gold Scalper Pro backtest core (shared by the /api/backtest endpoint and the CLI tool).
Pure functions; no MT5 dependency here — callers pass bars as [(ts,o,h,l,c), ...].
Replicates the Pine v6 "Gold Scalper Pro - Intraday Strategy":
  EMA(fast) x EMA(slow) crossover, RSI momentum band, UTC session filter,
  ATR SL/TP, next-bar-open fills, intrabar SL/TP (stop-first tie-break),
  reversal on opposite signal, commission per side.
"""
from datetime import datetime, timezone


def ema(vals, length):
    k = 2.0 / (length + 1)
    out = [None] * len(vals)
    prev = vals[0] if vals else 0.0
    for i, v in enumerate(vals):
        prev = v if i == 0 else v * k + prev * (1 - k)
        out[i] = prev
    return out


def wilder_rsi(closes, length):
    n = len(closes); rsi = [None] * n
    avg_g = avg_l = 0.0
    for i in range(1, n):
        ch = closes[i] - closes[i - 1]
        g = ch if ch > 0 else 0.0
        l = -ch if ch < 0 else 0.0
        if i <= length:
            avg_g += g; avg_l += l
            if i == length:
                avg_g /= length; avg_l /= length
                rsi[i] = 100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
        else:
            avg_g = (avg_g * (length - 1) + g) / length
            avg_l = (avg_l * (length - 1) + l) / length
            rsi[i] = 100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    return rsi


def wilder_atr(highs, lows, closes, length):
    n = len(closes); tr = [0.0] * n
    for i in range(n):
        tr[i] = (highs[i] - lows[i]) if i == 0 else max(
            highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
    atr = [None] * n; seed = 0.0
    for i in range(n):
        if i < length:
            seed += tr[i]
            if i == length - 1:
                atr[i] = seed / length
        else:
            atr[i] = (atr[i - 1] * (length - 1) + tr[i]) / length
    return atr


def backtest(bars, fast=21, slow=50, rsi_len=14, rsi_ob=70, rsi_os=30,
             atr_len=14, sl_mult=1.5, tp_mult=2.5, session="0800-1200",
             utc_offset=0, comm=0.0004, slip=2.0, tick=0.01, equity0=10000.0):
    """bars: list of (ts_seconds, open, high, low, close). Returns a stats dict."""
    if not bars or len(bars) < max(slow, rsi_len, atr_len) + 5:
        return {"error": "not enough bars", "trades": 0}

    t = [b[0] for b in bars]; o = [b[1] for b in bars]
    h = [b[2] for b in bars]; l = [b[3] for b in bars]; c = [b[4] for b in bars]
    n = len(c)

    emaF = ema(c, fast); emaS = ema(c, slow)
    rsi = wilder_rsi(c, rsi_len); atr = wilder_atr(h, l, c, atr_len)

    ss = int(session[:2]) * 60 + int(session[2:4])
    se = int(session[5:7]) * 60 + int(session[7:9])

    def in_sess(ts):
        d = datetime.fromtimestamp(ts + utc_offset * 3600, tz=timezone.utc)
        m = d.hour * 60 + d.minute
        return ss <= m < se

    equity = equity0
    trades = []          # (dir, entry, exit, ret_frac)
    pos = None
    peak = equity; maxdd = 0.0

    def close_pos(exit_px):
        nonlocal equity, pos
        d = pos['dir']
        gross = pos['units'] * (exit_px - pos['entry']) * d
        commission = (abs(pos['units'] * pos['entry']) + abs(pos['units'] * exit_px)) * comm
        equity += gross - commission
        ret = (gross - commission) / (pos['units'] * pos['entry']) if pos['entry'] else 0.0
        trades.append((d, pos['entry'], exit_px, ret))
        pos = None

    for i in range(1, n):
        if pos is not None:
            d = pos['dir']
            hit_sl = (l[i] <= pos['sl']) if d == 1 else (h[i] >= pos['sl'])
            hit_tp = (h[i] >= pos['tp']) if d == 1 else (l[i] <= pos['tp'])
            if hit_sl:            # stop-first on ties (conservative)
                close_pos(pos['sl'])
            elif hit_tp:
                close_pos(pos['tp'])

        if rsi[i] is None or atr[i] is None or i + 1 >= n:
            peak = max(peak, equity); maxdd = max(maxdd, (peak - equity) / peak if peak else 0)
            continue

        crossUp = emaF[i] > emaS[i] and emaF[i - 1] <= emaS[i - 1]
        crossDn = emaF[i] < emaS[i] and emaF[i - 1] >= emaS[i - 1]
        bull = 50 < rsi[i] < rsi_ob
        bear = rsi_os < rsi[i] < 50
        sess = in_sess(t[i])
        longSig = crossUp and bull and sess
        shortSig = crossDn and bear and sess

        def enter(direction, sig_close):
            nonlocal pos
            fill = o[i + 1] + slip * tick * direction
            units = equity / fill
            if direction == 1:
                sl = sig_close - atr[i] * sl_mult; tp = sig_close + atr[i] * tp_mult
            else:
                sl = sig_close + atr[i] * sl_mult; tp = sig_close - atr[i] * tp_mult
            pos = {'dir': direction, 'entry': fill, 'sl': sl, 'tp': tp, 'units': units}

        if longSig and (pos is None or pos['dir'] < 0):
            if pos is not None: close_pos(o[i + 1])
            enter(1, c[i])
        elif shortSig and (pos is None or pos['dir'] > 0):
            if pos is not None: close_pos(o[i + 1])
            enter(-1, c[i])

        peak = max(peak, equity); maxdd = max(maxdd, (peak - equity) / peak if peak else 0)

    # ---- stats ----
    ntr = len(trades)
    wins = [x for x in trades if x[3] > 0]
    losses = [x for x in trades if x[3] <= 0]
    gross_w = sum(x[3] for x in wins)
    gross_l = sum(x[3] for x in losses)
    avg_w = (gross_w / len(wins) * 100) if wins else 0.0
    avg_l = (gross_l / len(losses) * 100) if losses else 0.0
    net = (equity / equity0 - 1) * 100
    pf = (gross_w / abs(gross_l)) if gross_l else None
    payoff = (avg_w / abs(avg_l)) if avg_l else None
    be_wr = (abs(avg_l) / (avg_w + abs(avg_l)) * 100) if (avg_w + abs(avg_l)) else 0.0
    wr = (len(wins) / ntr * 100) if ntr else 0.0
    exp = (sum(x[3] for x in trades) / ntr * 100) if ntr else 0.0

    start_ts, end_ts = (bars[0][0], bars[-1][0]) if bars else (0, 0)
    return {
        "trades": ntr,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(wr, 2),
        "break_even_win_rate": round(be_wr, 2),
        "net_return_pct": round(net, 2),
        "profit_factor": round(pf, 2) if pf is not None else None,
        "payoff_ratio": round(payoff, 2) if payoff is not None else None,
        "avg_win_pct": round(avg_w, 3),
        "avg_loss_pct": round(avg_l, 3),
        "expectancy_pct": round(exp, 4),
        "max_drawdown_pct": round(maxdd * 100, 2),
        "equity_start": equity0,
        "equity_end": round(equity, 2),
        "bars": n,
        "from": datetime.fromtimestamp(start_ts, tz=timezone.utc).strftime("%Y-%m-%d"),
        "to": datetime.fromtimestamp(end_ts, tz=timezone.utc).strftime("%Y-%m-%d"),
        "verdict": ("MAKES MONEY" if (net > 0 and (pf or 0) > 1) else "LOSES MONEY")
                   + (" — <30 trades, not significant" if ntr < 30 else ""),
        "params": {"fast": fast, "slow": slow, "rsi_len": rsi_len, "atr_len": atr_len,
                   "sl_mult": sl_mult, "tp_mult": tp_mult, "session": session,
                   "utc_offset": utc_offset, "commission_per_side": comm},
    }
