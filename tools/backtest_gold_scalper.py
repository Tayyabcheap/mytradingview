#!/usr/bin/env python3
"""
Backtest for the "Gold Scalper Pro - Intraday Strategy" (Pine v6), replicated in Python.

Logic (matches the Pine exactly):
  - EMA(fast) crossover/crossunder EMA(slow)
  - RSI(len) momentum band: long needs 50<rsi<OB, short needs OS<rsi<50
  - session filter (UTC)
  - ATR(len)-based SL/TP from the SIGNAL bar close (SL=1.5*ATR, TP=2.5*ATR by default)
  - market entry fills at the NEXT bar open (Pine default), SL/TP checked intrabar
  - reverses on an opposite signal; one position at a time
  - costs: commission per side (%) + slippage (ticks)

Two data sources:
  --mt5 XAUUSDc --tf H1 --bars 5000        (Windows, MetaTrader5 must be running)
  --csv path.csv                            (columns: time,open,high,low,close[,volume])

Examples:
  python backtest_gold_scalper.py --mt5 XAUUSDc --tf H1 --bars 8000 --utc-offset -3
  python backtest_gold_scalper.py --csv gold_h1.csv --session 0800-1200
"""
import argparse, math, sys
from datetime import datetime, timezone

# ------------------------------ indicators ---------------------------------
def ema(vals, length):
    k = 2.0 / (length + 1)
    out = [None] * len(vals)
    prev = vals[0]
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

# ------------------------------ backtest -----------------------------------
def run(bars, p):
    t   = [b[0] for b in bars]
    o   = [b[1] for b in bars]
    h   = [b[2] for b in bars]
    l   = [b[3] for b in bars]
    c   = [b[4] for b in bars]
    n = len(c)
    emaF = ema(c, p.fast); emaS = ema(c, p.slow)
    rsi  = wilder_rsi(c, p.rsi_len)
    atr  = wilder_atr(h, l, c, p.atr_len)

    ss, se = p.sess  # start/end minutes UTC
    def in_sess(ts):
        d = datetime.fromtimestamp(ts + p.utc_offset * 3600, tz=timezone.utc)
        m = d.hour * 60 + d.minute
        return ss <= m < se

    equity = p.equity0
    trades = []           # (dir, entry, exit, ret_frac)
    pos = None            # dict: dir, entry, sl, tp, units
    curve = [equity]
    peak = equity; maxdd = 0.0

    def close_pos(exit_px, i):
        nonlocal equity, pos
        d = pos['dir']
        gross = pos['units'] * (exit_px - pos['entry']) * d
        # commission both sides on notional
        comm = (abs(pos['units'] * pos['entry']) + abs(pos['units'] * exit_px)) * p.comm
        equity += gross - comm
        ret = (gross - comm) / (pos['units'] * pos['entry']) if pos['entry'] else 0.0
        trades.append((d, pos['entry'], exit_px, ret))
        pos = None

    for i in range(1, n):
        # manage open position first (intrabar SL/TP on THIS bar)
        if pos is not None:
            d = pos['dir']
            hit_sl = (l[i] <= pos['sl']) if d == 1 else (h[i] >= pos['sl'])
            hit_tp = (h[i] >= pos['tp']) if d == 1 else (l[i] <= pos['tp'])
            if hit_sl and hit_tp:
                close_pos(pos['sl'], i)          # tie: assume stop first (conservative)
            elif hit_sl:
                close_pos(pos['sl'], i)
            elif hit_tp:
                close_pos(pos['tp'], i)

        # signal on bar i (uses close[i]); fills next bar open (i+1)
        if rsi[i] is None or atr[i] is None or i + 1 >= n:
            curve.append(equity)
            peak = max(peak, equity); maxdd = max(maxdd, (peak - equity) / peak if peak else 0)
            continue

        crossUp = emaF[i] > emaS[i] and emaF[i-1] <= emaS[i-1]
        crossDn = emaF[i] < emaS[i] and emaF[i-1] >= emaS[i-1]
        bull = 50 < rsi[i] < p.rsi_ob
        bear = p.rsi_os < rsi[i] < 50
        sess = in_sess(t[i])
        longSig  = crossUp and bull and sess
        shortSig = crossDn and bear and sess

        def enter(direction, sig_close):
            nonlocal pos, equity
            fill = o[i+1] + p.slip * p.tick * direction
            units = (equity / fill)              # 100% equity, no leverage cap
            if direction == 1:
                sl = sig_close - atr[i] * p.sl_mult
                tp = sig_close + atr[i] * p.tp_mult
            else:
                sl = sig_close + atr[i] * p.sl_mult
                tp = sig_close - atr[i] * p.tp_mult
            pos = {'dir': direction, 'entry': fill, 'sl': sl, 'tp': tp, 'units': units}

        if longSig and (pos is None or pos['dir'] < 0):
            if pos is not None: close_pos(o[i+1], i)
            enter(1, c[i])
        elif shortSig and (pos is None or pos['dir'] > 0):
            if pos is not None: close_pos(o[i+1], i)
            enter(-1, c[i])

        curve.append(equity)
        peak = max(peak, equity); maxdd = max(maxdd, (peak - equity) / peak if peak else 0)

    return trades, equity, maxdd, curve

# ------------------------------ reporting ----------------------------------
def report(trades, equity0, equity1, maxdd, tf, symbol, nbars):
    n = len(trades)
    wins = [t for t in trades if t[3] > 0]
    losses = [t for t in trades if t[3] <= 0]
    wr = len(wins) / n * 100 if n else 0
    gross_w = sum(t[3] for t in wins)
    gross_l = sum(t[3] for t in losses)
    pf = (gross_w / abs(gross_l)) if gross_l else float('inf')
    avg_w = (gross_w / len(wins) * 100) if wins else 0
    avg_l = (gross_l / len(losses) * 100) if losses else 0
    payoff = (avg_w / abs(avg_l)) if avg_l else float('inf')
    net = (equity1 / equity0 - 1) * 100
    exp = sum(t[3] for t in trades) / n * 100 if n else 0
    be_wr = (abs(avg_l) / (avg_w + abs(avg_l)) * 100) if (avg_w + abs(avg_l)) else 0

    print("=" * 60)
    print(f"  GOLD SCALPER PRO  —  backtest")
    print(f"  {symbol}  {tf}   bars={nbars}")
    print("=" * 60)
    print(f"  Trades              {n}")
    print(f"  Win rate            {wr:6.2f}%   (break-even needs {be_wr:.1f}%)")
    print(f"  Net return          {net:+7.2f}%   (equity {equity0:.0f} -> {equity1:.0f})")
    print(f"  Profit factor       {pf:6.2f}")
    print(f"  Payoff (avgW/avgL)  {payoff:6.2f}")
    print(f"  Avg win / avg loss  {avg_w:+.2f}% / {avg_l:+.2f}%")
    print(f"  Expectancy / trade  {exp:+.3f}%")
    print(f"  Max drawdown        {maxdd*100:6.2f}%")
    print("=" * 60)
    verdict = "MAKES MONEY" if net > 0 and pf > 1 else "LOSES MONEY"
    if n < 30:
        verdict += "  (WARNING: <30 trades — not statistically meaningful)"
    print(f"  Verdict: {verdict}")
    print("=" * 60)

# ------------------------------ data loaders -------------------------------
def load_csv(path):
    import csv
    rows = []
    with open(path, newline='') as f:
        r = csv.DictReader(f)
        for row in r:
            keys = {k.lower(): k for k in row}
            ts = row[keys['time']]
            try: ts = int(float(ts))
            except ValueError: ts = int(datetime.fromisoformat(ts).replace(tzinfo=timezone.utc).timestamp())
            rows.append((ts, float(row[keys['open']]), float(row[keys['high']]),
                         float(row[keys['low']]), float(row[keys['close']])))
    rows.sort(key=lambda x: x[0])
    return rows

def load_mt5(symbol, tf, bars):
    import MetaTrader5 as mt5
    tfmap = {'M1': mt5.TIMEFRAME_M1, 'M5': mt5.TIMEFRAME_M5, 'M15': mt5.TIMEFRAME_M15,
             'M30': mt5.TIMEFRAME_M30, 'H1': mt5.TIMEFRAME_H1, 'H4': mt5.TIMEFRAME_H4, 'D1': mt5.TIMEFRAME_D1}
    if not mt5.initialize():
        print("MT5 initialize() failed — is the terminal running and logged in?"); sys.exit(1)
    mt5.symbol_select(symbol, True)
    rates = mt5.copy_rates_from_pos(symbol, tfmap[tf], 0, bars)
    mt5.shutdown()
    if rates is None or len(rates) == 0:
        print("No rates returned from MT5."); sys.exit(1)
    return [(int(r['time']), float(r['open']), float(r['high']), float(r['low']), float(r['close'])) for r in rates]

def parse_session(s):
    a, b = s.split('-')
    return (int(a[:2]) * 60 + int(a[2:]), int(b[:2]) * 60 + int(b[2:]))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv'); ap.add_argument('--mt5'); ap.add_argument('--tf', default='H1')
    ap.add_argument('--bars', type=int, default=8000)
    ap.add_argument('--fast', type=int, default=21); ap.add_argument('--slow', type=int, default=50)
    ap.add_argument('--rsi-len', type=int, default=14); ap.add_argument('--rsi-ob', type=float, default=70)
    ap.add_argument('--rsi-os', type=float, default=30); ap.add_argument('--atr-len', type=int, default=14)
    ap.add_argument('--sl-mult', type=float, default=1.5); ap.add_argument('--tp-mult', type=float, default=2.5)
    ap.add_argument('--session', default='0800-1200'); ap.add_argument('--utc-offset', type=int, default=0,
        help='broker-time to true-UTC hour offset (e.g. -3 for a GMT+3 broker)')
    ap.add_argument('--comm', type=float, default=0.0004, help='commission fraction per side (0.04%%=0.0004)')
    ap.add_argument('--slip', type=float, default=2); ap.add_argument('--tick', type=float, default=0.01)
    ap.add_argument('--equity0', type=float, default=10000)
    a = ap.parse_args()

    class P: pass
    p = P()
    p.fast, p.slow, p.rsi_len, p.rsi_ob, p.rsi_os = a.fast, a.slow, a.rsi_len, a.rsi_ob, a.rsi_os
    p.atr_len, p.sl_mult, p.tp_mult = a.atr_len, a.sl_mult, a.tp_mult
    p.sess = parse_session(a.session); p.utc_offset = a.utc_offset
    p.comm, p.slip, p.tick, p.equity0 = a.comm, a.slip, a.tick, a.equity0

    if a.csv:
        bars = load_csv(a.csv); src = f"CSV:{a.csv}"; tf = a.tf
    elif a.mt5:
        bars = load_mt5(a.mt5, a.tf, a.bars); src = a.mt5; tf = a.tf
    else:
        print("Provide --csv PATH or --mt5 SYMBOL"); sys.exit(1)

    trades, eq1, maxdd, _ = run(bars, p)
    report(trades, p.equity0, eq1, maxdd, tf, src, len(bars))

if __name__ == '__main__':
    main()
