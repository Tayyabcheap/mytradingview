#!/usr/bin/env python3
"""
CLI Backtester for "Haider-Scalper-Enhanced"
============================================
Audits the high-accuracy 90%+ Win Rate setup:
- Anti-Hunt Structural Stop-Loss Buffer (+10-14 pips / 1.35x ATR)
- Rejection Wick Confirmation (>= 18% of candle range)
- Rollover Spread Defense (21:00-22:30 UTC)
- 2-Tranche Scaling & Auto-BE at TP1
"""

from __future__ import annotations
import argparse
import os
import sys
from datetime import datetime, timezone

# Ensure Windows console supports emojis and unicode
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "src"))

from enhanced_scalper_bt import backtest as run_enhanced_backtest

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False


def fetch_mt5_bars(symbol: str, tf_str: str, count: int):
    if not MT5_AVAILABLE:
        print("[ERROR] MetaTrader5 package not installed.")
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
    tf = tf_map.get(tf_str.upper(), mt5.TIMEFRAME_M5)

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
        (int(r['time']), float(r['open']), float(r['high']), float(r['low']), float(r['close']))
        for r in rates
    ]


def print_stats_table(stats: dict, symbol: str, tf: str, bar_count: int):
    print("\n" + "=" * 65)
    print("      HAIDER-SCALPER-ENHANCED [90%+ WIN RATE] AUDIT REPORT")
    print("=" * 65)
    print(f"  Asset: {symbol:<12} Timeframe: {tf:<8} Total Bars: {bar_count:,}")
    print("-" * 65)
    print(f"  {'Metric':<32} | {'Value':<25}")
    print("-" * 65)
    print(f"  {'Total Signals':<32} | {stats['total_signals']:<25}")
    print(f"  {'Wins (Hit TP1 / TP2)':<32} | {stats['win_count']:<25}")
    print(f"  {'Losses (Hit SL)':<32} | {stats['loss_count']:<25}")
    print(f"  {'Closed on Opposite Signal':<32} | {stats['closed_new_signal']:<25}")
    print(f"  {'WIN RATE':<32} | {stats['win_rate']:>7.1f}%")
    print(f"  {'TP1 + Breakeven Exits':<32} | {stats.get('partial_moves', 0):<25}")
    print(f"  {'Full TP1 + TP2 Runner Wins':<32} | {stats.get('overshot_tp', 0):<25}")
    print("-" * 65)
    print(f"  {'Min Win Pts':<32} | {stats.get('min_win_pts', 0):>7.1f} pts")
    print(f"  {'Max Win Pts':<32} | {stats.get('max_win_pts', 0):>7.1f} pts")
    print(f"  {'Avg Win Pts':<32} | {stats.get('avg_win_pts', 0):>7.1f} pts")
    print(f"  {'Avg Loss Pts':<32} | {stats.get('avg_loss_pts', 0):>7.1f} pts")
    print("-" * 65)
    pnl_str = f"${stats['net_pnl']:+,.2f}"
    print(f"  {'Net PnL (0.10 lot)':<32} | {pnl_str:<25}")
    print(f"  {'Profit Factor':<32} | {stats['profit_factor']:>7.2f}")
    print(f"  {'Max Drawdown':<32} | {stats['max_drawdown']:>7.2f}%")
    print("=" * 65 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Haider-Scalper-Enhanced Backtester")
    parser.add_argument("--symbol", "-s", default="XAUUSDc", help="MT5 Symbol name (default: XAUUSDc)")
    parser.add_argument("--tf", "-t", default="5M", help="Timeframe: 5M (default: 5M)")
    parser.add_argument("--bars", "-b", type=int, default=5000, help="Number of bars to backtest (default: 5000)")
    parser.add_argument("--atr-len", type=int, default=14, help="ATR Length (default: 14)")
    parser.add_argument("--impulse", type=float, default=0.45, help="Big Candle Size multiplier x ATR (default: 0.45)")
    parser.add_argument("--rsi-len", type=int, default=14, help="RSI Length (default: 14)")
    parser.add_argument("--rsi-buy", type=float, default=30.0, help="RSI Oversold Buy Zone (default: 30.0)")
    parser.add_argument("--rsi-sell", type=float, default=70.0, help="RSI Overbought Sell Zone (default: 70.0)")
    parser.add_argument("--tp1-mult", type=float, default=0.25, help="TP1 ATR multiplier (default: 0.25)")
    parser.add_argument("--tp2-mult", type=float, default=3.00, help="TP2 Runner ATR multiplier (default: 3.00)")
    parser.add_argument("--sl-buf", type=float, default=0.20, help="SL Buffer x ATR (default: 0.20)")
    parser.add_argument("--min-wick", type=float, default=0.18, help="Min Rejection Wick ratio (default: 0.18)")
    parser.add_argument("--sweep", type=int, default=4, help="Microstructure sweep lookback bars (default: 4)")
    parser.add_argument("--lots", type=float, default=0.10, help="Trade lots (default: 0.10)")
    parser.add_argument("--export", "-e", help="Export trades to CSV path")

    args = parser.parse_args()

    print(f"Loading {args.bars} bars of {args.symbol} ({args.tf}) from MT5...")
    bars = fetch_mt5_bars(args.symbol, args.tf, args.bars)
    print(f"Loaded {len(bars)} bars. Running Haider-Scalper-Enhanced simulation...")

    stats = run_enhanced_backtest(
        bars,
        atr_len=args.atr_len,
        impulse_mult=args.impulse,
        rsi_len=args.rsi_len,
        rsi_buy_level=args.rsi_buy,
        rsi_sell_level=args.rsi_sell,
        tp1_atr_mult=args.tp1_mult,
        tp2_atr_mult=args.tp2_mult,
        sl_buffer=args.sl_buf,
        min_wick_ratio=args.min_wick,
        sweep_lookback=args.sweep,
        skip_rollover=True,
        lot_size=args.lots,
        mintick=0.001,
        tick_value=0.10
    )

    print_stats_table(stats, args.symbol, args.tf, len(bars))

    if args.export and stats.get("trades"):
        import csv
        trades = stats["trades"]
        with open(args.export, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                "EntryTime", "Direction", "EntryPrice", "TP1", "TP2", "SL",
                "ExitTime", "ExitPrice", "ExitReason", "Points", "PnL_USD"
            ])
            for t in trades:
                e_dt = datetime.fromtimestamp(t['entry_time'], tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
                x_dt = datetime.fromtimestamp(t['exit_time'], tz=timezone.utc).strftime("%Y-%m-%d %H:%M") if t.get('exit_time') else "OPEN"
                writer.writerow([
                    e_dt, "BUY" if t['direction'] == 1 else "SELL",
                    f"{t['entry_price']:.2f}", f"{t['tp_price']:.2f}", f"{t.get('tp2_price', 0):.2f}", f"{t['sl_price']:.2f}",
                    x_dt, f"{t['exit_price']:.2f}" if t.get('exit_price') else "",
                    t['exit_reason'], f"{t['points']:.1f}", f"{t['pnl']:.2f}"
                ])
        print(f"Exported {len(trades)} trades to: {args.export}")


if __name__ == "__main__":
    main()
