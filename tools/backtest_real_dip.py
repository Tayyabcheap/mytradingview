#!/usr/bin/env python3
"""
Backtester for "Haider-Gold-Scalper [SL Buffer]" (Pine Script v6)
================================================================
Replicates the user's Pine Script v6 indicator & strategy in Python,
connecting directly to MT5 or CSV data.

Strategy Logic:
  1. Detect impulse candle:
     candleBody > (currentAtr * impulseMult)
  2. RSI exhaustion filter:
     Buy:  close < open and rsi < rsiBuyLevel (default 35.0)
     Sell: close > open and rsi > rsiSellLevel (default 65.0)
  3. Targets:
     TP: 50% retracement of the impulse candle range
     SL: low - (currentAtr * slBuffer) for Buy / high + (currentAtr * slBuffer) for Sell
  4. Execution:
     Signal confirmed on candle close; entry at the NEXT candle OPEN.
  5. Trade Tracking & Stats:
     Monitors intrabar high/low for TP or SL hits, bucketed excursions,
     and produces the exact TradingView statistics table.
"""

from __future__ import annotations
import argparse
import math
import os
import sys
from datetime import datetime, timezone
from typing import List, Tuple, Dict, Any, Optional

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False


# ---------------------------------------------------------------------------
# Technical Indicators (Wilder RMA formulas matching Pine Script)
# ---------------------------------------------------------------------------

def rma(src: List[float], length: int) -> List[Optional[float]]:
    """Wilder's Moving Average (RMA) used in Pine Script's ta.rsi and ta.atr."""
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


def ta_rsi(closes: List[float], length: int = 14) -> List[Optional[float]]:
    """Exact Pine Script ta.rsi implementation using Wilder's RMA."""
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


def ta_atr(highs: List[float], lows: List[float], closes: List[float], length: int = 14) -> List[Optional[float]]:
    """Exact Pine Script ta.atr implementation using true range and RMA."""
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


# ---------------------------------------------------------------------------
# Data Structures
# ---------------------------------------------------------------------------

class Bar:
    __slots__ = ('time', 'open', 'high', 'low', 'close', 'volume')

    def __init__(self, time: int, open_: float, high: float, low: float, close: float, volume: float = 0.0):
        self.time = time
        self.open = open_
        self.high = high
        self.low = low
        self.close = close
        self.volume = volume


class Trade:
    def __init__(
        self,
        signal_idx: int,
        entry_idx: int,
        direction: int, # 1 for Buy, -1 for Sell
        entry_price: float,
        sl_price: float,
        tp_price: float,
        trade_range: float,
        entry_time: int
    ):
        self.signal_idx = signal_idx
        self.entry_idx = entry_idx
        self.direction = direction
        self.entry_price = entry_price
        self.sl_price = sl_price
        self.tp_price = tp_price
        self.trade_range = trade_range
        self.entry_time = entry_time

        self.exit_idx: Optional[int] = None
        self.exit_time: Optional[int] = None
        self.exit_price: Optional[float] = None
        self.exit_reason: str = "OPEN" # "TP HIT", "SL HIT", "CLOSED @ NEW SIGNAL", "STILL OPEN"
        self.max_excursion: float = 0.0
        self.points: float = 0.0
        self.pnl: float = 0.0
        self.trade_pct: float = 0.0


# ---------------------------------------------------------------------------
# Backtest Engine
# ---------------------------------------------------------------------------

def run_backtest(
    bars: List[Bar],
    atr_len: int = 14,
    impulse_mult: float = 1.0,
    rsi_len: int = 14,
    rsi_buy_level: float = 35.0,
    rsi_sell_level: float = 65.0,
    target_level: float = 50.0,
    sl_buffer: float = 1.0,
    mintick: float = 0.01,
    lot_size: float = 0.1,
    tick_value: float = 1.0 # USD per point for 1.0 lot
) -> Tuple[List[Trade], Dict[str, Any]]:
    n = len(bars)
    if n < max(atr_len, rsi_len) + 5:
        return [], {}

    opens = [b.open for b in bars]
    highs = [b.high for b in bars]
    lows = [b.low for b in bars]
    closes = [b.close for b in bars]

    atr = ta_atr(highs, lows, closes, atr_len)
    rsi = ta_rsi(closes, rsi_len)

    setup_state = 0
    setup_bar_index = -1
    setup_high = 0.0
    setup_low = 0.0
    setup_range = 0.0
    tp_level = 0.0
    sl_level = 0.0

    trades: List[Trade] = []
    active_trade: Optional[Trade] = None

    buckets = {
        'small': 0,
        'b10': 0,
        'b20': 0,
        'b30': 0,
        'b50': 0,
        'b70': 0,
        'b100': 0
    }
    win_points_array: List[float] = []

    for i in range(1, n):
        b = bars[i]
        curr_atr = atr[i]
        curr_rsi = rsi[i]

        # 1. Manage Active Trade on Intrabar Data
        if active_trade is not None:
            t = active_trade
            if t.direction == 1: # Long
                t.max_excursion = max(t.max_excursion, b.high - t.entry_price)
                if b.low <= t.sl_price:
                    t.exit_idx = i
                    t.exit_time = b.time
                    t.exit_price = t.sl_price
                    t.exit_reason = "SL HIT"
                    t.points = -(abs(t.sl_price - t.entry_price) / mintick)
                    t.pnl = (t.sl_price - t.entry_price) * lot_size * (tick_value / mintick)
                    active_trade = None
                elif b.high >= t.tp_price:
                    t.exit_idx = i
                    t.exit_time = b.time
                    t.exit_price = t.tp_price
                    t.exit_reason = "TP HIT"
                    t.points = abs(t.tp_price - t.entry_price) / mintick
                    t.pnl = (t.tp_price - t.entry_price) * lot_size * (tick_value / mintick)
                    win_points_array.append(t.points)
                    active_trade = None
            else: # Short
                t.max_excursion = max(t.max_excursion, t.entry_price - b.low)
                if b.high >= t.sl_price:
                    t.exit_idx = i
                    t.exit_time = b.time
                    t.exit_price = t.sl_price
                    t.exit_reason = "SL HIT"
                    t.points = -(abs(t.sl_price - t.entry_price) / mintick)
                    t.pnl = (t.entry_price - t.sl_price) * lot_size * (tick_value / mintick)
                    active_trade = None
                elif b.low <= t.tp_price:
                    t.exit_idx = i
                    t.exit_time = b.time
                    t.exit_price = t.tp_price
                    t.exit_reason = "TP HIT"
                    t.points = abs(t.tp_price - t.entry_price) / mintick
                    t.pnl = (t.entry_price - t.tp_price) * lot_size * (tick_value / mintick)
                    win_points_array.append(t.points)
                    active_trade = None

        # 2. State Machine: Invalidate Setup if Price Breached SL before trigger
        if setup_state == 1 and b.high > sl_level:
            setup_state = 0
        if setup_state == -1 and b.low < sl_level:
            setup_state = 0

        # 3. Check Signal Trigger from Previous Setup (Executes at current open)
        buy_signal = False
        sell_signal = False
        entry_val = b.open

        if setup_state == 1 and i > setup_bar_index:
            sell_signal = True
            setup_state = 0

        if setup_state == -1 and i > setup_bar_index:
            buy_signal = True
            setup_state = 0

        # Handle New Signal & Trade Launch
        if buy_signal or sell_signal:
            if active_trade is not None:
                old_t = active_trade
                old_t.exit_idx = i
                old_t.exit_time = b.time
                old_t.exit_price = b.open
                old_t.exit_reason = "CLOSED @ NEW SIGNAL"
                if old_t.direction == 1:
                    old_t.points = (b.open - old_t.entry_price) / mintick
                    old_t.pnl = (b.open - old_t.entry_price) * lot_size * (tick_value / mintick)
                else:
                    old_t.points = (old_t.entry_price - b.open) / mintick
                    old_t.pnl = (old_t.entry_price - b.open) * lot_size * (tick_value / mintick)

                if old_t.trade_range > 0:
                    pct = (old_t.max_excursion / old_t.trade_range) * 100.0
                    old_t.trade_pct = pct
                    if pct >= 100: buckets['b100'] += 1
                    elif pct >= 70: buckets['b70'] += 1
                    elif pct >= 50: buckets['b50'] += 1
                    elif pct >= 30: buckets['b30'] += 1
                    elif pct >= 20: buckets['b20'] += 1
                    elif pct >= 10: buckets['b10'] += 1
                    else: buckets['small'] += 1
                active_trade = None

            direction = 1 if buy_signal else -1
            t_range = abs(tp_level - entry_val)
            new_trade = Trade(
                signal_idx=setup_bar_index,
                entry_idx=i,
                direction=direction,
                entry_price=entry_val,
                sl_price=sl_level,
                tp_price=tp_level,
                trade_range=t_range,
                entry_time=b.time
            )
            trades.append(new_trade)
            active_trade = new_trade

        # 4. Register Setup on Confirmed Bar Close
        if curr_atr is not None and curr_rsi is not None:
            candle_body = abs(b.close - b.open)
            candle_range = b.high - b.low

            is_real_buy = (b.close < b.open) and (candle_body > (curr_atr * impulse_mult)) and (curr_rsi < rsi_buy_level)
            is_real_sell = (b.close > b.open) and (candle_body > (curr_atr * impulse_mult)) and (curr_rsi > rsi_sell_level)

            if is_real_sell and setup_state == 0:
                setup_state = 1
                setup_bar_index = i
                setup_high = b.high
                setup_low = b.low
                setup_range = candle_range
                tp_level = setup_high - (setup_range * (target_level / 100.0))
                sl_level = setup_high + (curr_atr * sl_buffer)
            elif is_real_buy and setup_state == 0:
                setup_state = -1
                setup_bar_index = i
                setup_high = b.high
                setup_low = b.low
                setup_range = candle_range
                tp_level = setup_low + (setup_range * (target_level / 100.0))
                sl_level = setup_low - (curr_atr * sl_buffer)

    # Finish remaining active trade at chart end
    if active_trade is not None:
        last_b = bars[-1]
        active_trade.exit_idx = n - 1
        active_trade.exit_time = last_b.time
        active_trade.exit_price = last_b.close
        active_trade.exit_reason = "STILL OPEN"
        if active_trade.direction == 1:
            active_trade.points = (last_b.close - active_trade.entry_price) / mintick
            active_trade.pnl = (last_b.close - active_trade.entry_price) * lot_size * (tick_value / mintick)
        else:
            active_trade.points = (active_trade.entry_price - last_b.close) / mintick
            active_trade.pnl = (active_trade.entry_price - last_b.close) * lot_size * (tick_value / mintick)

        if active_trade.trade_range > 0:
            pct = (active_trade.max_excursion / active_trade.trade_range) * 100.0
            active_trade.trade_pct = pct
            if pct >= 100: buckets['b100'] += 1
            elif pct >= 70: buckets['b70'] += 1
            elif pct >= 50: buckets['b50'] += 1
            elif pct >= 30: buckets['b30'] += 1
            elif pct >= 20: buckets['b20'] += 1
            elif pct >= 10: buckets['b10'] += 1
            else: buckets['small'] += 1

    # 5. Compile Statistics
    total_signals = len(trades)
    win_count = sum(1 for t in trades if t.exit_reason == "TP HIT")
    loss_count = sum(1 for t in trades if t.exit_reason == "SL HIT")
    closed_signal_count = sum(1 for t in trades if t.exit_reason == "CLOSED @ NEW SIGNAL")

    win_rate = (win_count / total_signals * 100.0) if total_signals > 0 else 0.0

    min_win_pts = min(win_points_array) if win_points_array else 0.0
    max_win_pts = max(win_points_array) if win_points_array else 0.0
    avg_win_pts = (sum(win_points_array) / len(win_points_array)) if win_points_array else 0.0

    if win_points_array:
        sorted_wins = sorted(win_points_array)
        nw = len(sorted_wins)
        median_win_pts = sorted_wins[nw // 2] if nw % 2 == 1 else (sorted_wins[nw // 2 - 1] + sorted_wins[nw // 2]) / 2.0
    else:
        median_win_pts = 0.0

    net_pnl = sum(t.pnl for t in trades)
    gross_profit = sum(t.pnl for t in trades if t.pnl > 0)
    gross_loss = abs(sum(t.pnl for t in trades if t.pnl < 0))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)

    equity_curve = [10000.0]
    peak = 10000.0
    max_dd = 0.0
    for t in trades:
        cur_eq = equity_curve[-1] + t.pnl
        equity_curve.append(cur_eq)
        if cur_eq > peak:
            peak = cur_eq
        dd = (peak - cur_eq) / peak if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd

    stats = {
        'total_signals': total_signals,
        'win_count': win_count,
        'loss_count': loss_count,
        'closed_new_signal': closed_signal_count,
        'win_rate': win_rate,
        'partial_moves': buckets['b10'] + buckets['b20'] + buckets['b30'],
        'overshot_tp': buckets['b50'] + buckets['b70'] + buckets['b100'],
        'min_win_pts': min_win_pts,
        'max_win_pts': max_win_pts,
        'avg_win_pts': avg_win_pts,
        'median_win_pts': median_win_pts,
        'net_pnl': net_pnl,
        'profit_factor': profit_factor,
        'max_drawdown_pct': max_dd * 100.0,
        'buckets': buckets
    }

    return trades, stats


# ---------------------------------------------------------------------------
# CLI Reporter
# ---------------------------------------------------------------------------

def print_stats_table(stats: Dict[str, Any], symbol: str, tf: str, num_bars: int) -> None:
    print("\n" + "=" * 62)
    print(f"      HAIDER-GOLD-SCALPER [SL BUFFER] — BACKTEST REPORT")
    print("=" * 62)
    print(f"  Asset: {symbol:<12} Timeframe: {tf:<8} Total Bars: {num_bars:,}")
    print("-" * 62)
    print(f"  {'Haider-Gold-Scalper Stats':<30} | {'Count / Value':<24}")
    print("-" * 62)
    print(f"  {'Total Signals':<30} | {stats['total_signals']:<24}")
    print(f"  {'Wins (Hit TP)':<30} | {stats['win_count']:<24}")
    print(f"  {'Losses (Hit SL)':<30} | {stats['loss_count']:<24}")
    print(f"  {'Closed on Opposite Signal':<30} | {stats['closed_new_signal']:<24}")
    print(f"  {'Win Rate':<30} | {stats['win_rate']:>6.1f}%")
    print(f"  {'Partial Moves (10-30%)':<30} | {stats['partial_moves']:<24}")
    print(f"  {'Overshot TP (50-100%)':<30} | {stats['overshot_tp']:<24}")
    print("-" * 62)
    print(f"  {'Min Win Pts':<30} | {stats['min_win_pts']:>8.1f} pts")
    print(f"  {'Max Win Pts':<30} | {stats['max_win_pts']:>8.1f} pts")
    print(f"  {'Avg Win Pts':<30} | {stats['avg_win_pts']:>8.1f} pts")
    print(f"  {'Median Win Pts':<30} | {stats['median_win_pts']:>8.1f} pts")
    print("-" * 62)
    print(f"  {'Net PnL (0.10 lot)':<30} | ${stats['net_pnl']:>+10.2f}")
    print(f"  {'Profit Factor':<30} | {stats['profit_factor']:>8.2f}")
    print(f"  {'Max Drawdown':<30} | {stats['max_drawdown_pct']:>7.2f}%")
    print("=" * 62 + "\n")


# ---------------------------------------------------------------------------
# Data Fetchers
# ---------------------------------------------------------------------------

def fetch_mt5_bars(symbol: str, tf_str: str, count: int) -> List[Bar]:
    if not MT5_AVAILABLE:
        print("[ERROR] MetaTrader5 package is not installed or available.")
        sys.exit(1)

    tf_map = {
        '1M': mt5.TIMEFRAME_M1, 'M1': mt5.TIMEFRAME_M1,
        '5M': mt5.TIMEFRAME_M5, 'M5': mt5.TIMEFRAME_M5,
        '15M': mt5.TIMEFRAME_M15, 'M15': mt5.TIMEFRAME_M15,
        '30M': mt5.TIMEFRAME_M30, 'M30': mt5.TIMEFRAME_M30,
        '1H': mt5.TIMEFRAME_H1, 'H1': mt5.TIMEFRAME_H1,
        '4H': mt5.TIMEFRAME_H4, 'H4': mt5.TIMEFRAME_H4,
        '1D': mt5.TIMEFRAME_D1, 'D1': mt5.TIMEFRAME_D1
    }
    tf = tf_map.get(tf_str.upper(), mt5.TIMEFRAME_H1)

    if not mt5.initialize():
        print(f"[ERROR] Failed to initialize MT5: {mt5.last_error()}")
        sys.exit(1)

    mt5.symbol_select(symbol, True)
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
    mt5.shutdown()

    if rates is None or len(rates) == 0:
        print(f"[ERROR] No rates returned for symbol '{symbol}' on timeframe '{tf_str}'.")
        sys.exit(1)

    return [
        Bar(int(r['time']), float(r['open']), float(r['high']), float(r['low']), float(r['close']), float(r['tick_volume']))
        for r in rates
    ]


def main():
    parser = argparse.ArgumentParser(description="Haider-Gold-Scalper [SL Buffer] Pine Script Backtester")
    parser.add_argument("--symbol", "-s", default="XAUUSDc", help="MT5 Symbol name (default: XAUUSDc)")
    parser.add_argument("--tf", "-t", default="1H", help="Timeframe: 1M, 5M, 15M, 1H, 4H, 1D (default: 1H)")
    parser.add_argument("--bars", "-b", type=int, default=5000, help="Number of bars to backtest (default: 5000)")
    parser.add_argument("--atr-len", type=int, default=14, help="ATR Length (default: 14)")
    parser.add_argument("--impulse", type=float, default=1.0, help="Big Candle Size multiplier x ATR (default: 1.0)")
    parser.add_argument("--rsi-len", type=int, default=14, help="RSI Length (default: 14)")
    parser.add_argument("--rsi-buy", type=float, default=35.0, help="RSI Oversold Buy Zone (default: 35.0)")
    parser.add_argument("--rsi-sell", type=float, default=65.0, help="RSI Overbought Sell Zone (default: 65.0)")
    parser.add_argument("--tp-pct", type=float, default=50.0, help="Target Level %% TP (default: 50.0)")
    parser.add_argument("--sl-buf", type=float, default=1.0, help="SL Buffer x ATR (default: 1.0)")
    parser.add_argument("--lots", type=float, default=0.10, help="Trade lots (default: 0.10)")
    parser.add_argument("--export", "-e", help="Export trades to CSV path (e.g. data/real_dip_trades.csv)")

    args = parser.parse_args()

    print(f"Loading {args.bars} bars of {args.symbol} ({args.tf}) from MT5...")
    bars = fetch_mt5_bars(args.symbol, args.tf, args.bars)
    print(f"Loaded {len(bars)} bars. Running backtest simulation...")

    trades, stats = run_backtest(
        bars,
        atr_len=args.atr_len,
        impulse_mult=args.impulse,
        rsi_len=args.rsi_len,
        rsi_buy_level=args.rsi_buy,
        rsi_sell_level=args.rsi_sell,
        target_level=args.tp_pct,
        sl_buffer=args.sl_buf,
        mintick=0.01,
        lot_size=args.lots
    )

    print_stats_table(stats, args.symbol, args.tf, len(bars))

    if args.export and trades:
        import csv
        with open(args.export, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                "EntryTime", "Direction", "EntryPrice", "TP", "SL",
                "ExitTime", "ExitPrice", "ExitReason", "Points", "PnL_USD"
            ])
            for t in trades:
                e_dt = datetime.fromtimestamp(t.entry_time, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
                x_dt = datetime.fromtimestamp(t.exit_time, tz=timezone.utc).strftime("%Y-%m-%d %H:%M") if t.exit_time else "OPEN"
                writer.writerow([
                    e_dt, "BUY" if t.direction == 1 else "SELL",
                    f"{t.entry_price:.2f}", f"{t.tp_price:.2f}", f"{t.sl_price:.2f}",
                    x_dt, f"{t.exit_price:.2f}" if t.exit_price else "",
                    t.exit_reason, f"{t.points:.1f}", f"{t.pnl:.2f}"
                ])
        print(f"Exported {len(trades)} trades to: {args.export}")


if __name__ == "__main__":
    main()
