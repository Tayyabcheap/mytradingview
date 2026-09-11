"""
MyTradingView — Backtester
==========================

Simulates the playbook's full trade management, which no previous version did:

    TP1        close 75% at the first target                (§4)
    TRAIL      then move the stop to the 3M swing anchor    ([TRADE_MANAGEMENT_ENGINE])
    CTC        breakeven plus spread at +50 pips            (§4)
    DISCIPLINE per-session trade cap and the two-stop pause (§4)

Every trade is stamped with `config.strategy_fingerprint()`, so a result file
can never again silently outlive the rules that produced it — which is exactly
what happened to the previous CSVs. They were generated with a +12 pip CTC,
30/55 pip targets and stops as tight as 1.8 points; the engine that shipped
alongside them had a 4.50 minimum stop and 40/60/120 pip parameters, and so was
incapable of producing a single row in the files the dashboard was reporting.

Run it with RUN_BACKTEST.bat, or:
    python backtester.py --days 365 --strategy both
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

import config
import metrics
import risk
import timeframes
from indicators import (prepare_dataframe, resample_ohlc, trailing_swing_high,
                        trailing_swing_low)
from signal_engine import SWING_PRO, SWING_CORE, SignalEngine

try:
    import MetaTrader5 as mt5
except Exception:
    mt5 = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(BASE_DIR), "data")


class Backtester:
    def __init__(self, symbol: str = config.SYMBOL, days: int = 365, lots: float = 0.10):
        self.symbol = symbol
        self.days = days
        self.lots = lots
        self.spread = config.TYPICAL_SPREAD_USD
        self.utc_offset = 0.0
        self.ltf_name = config.TIMEFRAME_LTF
        self.covered_days = days

    # -- data ---------------------------------------------------------------

    def fetch(self) -> Optional[Tuple[pd.DataFrame, ...]]:
        if mt5 is None:
            print("[!] The MetaTrader5 package is not installed. "
                  "Run this on the Windows machine where MT5 lives.", flush=True)
            return None
        if not mt5.initialize():
            print(f"[!] Could not start MetaTrader 5: {mt5.last_error()}", flush=True)
            return None

        sym = self.symbol
        if mt5.symbol_info(sym) is None:
            sym = config.FALLBACK_SYMBOL
            if mt5.symbol_info(sym) is None:
                print(f"[!] Neither {self.symbol} nor {sym} exists on this account.", flush=True)
                return None
        mt5.symbol_select(sym, True)
        self.symbol = sym

        to = datetime.now()
        frm = to - timedelta(days=self.days)

        def probe(c):
            return mt5.copy_rates_from_pos(sym, c, 0, 5)

        def grab(name):
            """
            Pull one timeframe, downgrading if the broker does not serve it.

            Returns (dataframe, effective_name). The 3M period is the one that
            bites: MetaTrader defines the constant on every build, but plenty
            of brokers never aggregate 3-minute bars, so the request comes back
            empty and looks exactly like an account with no history at all.
            """
            eff, c = timeframes.resolve(name, probe, scope=sym)
            d = timeframes.range_bars(sym, c, frm, to)
            if d is None or len(d) == 0:
                print(f"[!] No {eff} history returned.", flush=True)
                return None, eff
            d["time"] = pd.to_datetime(d["time"], unit="s")
            tag = eff if eff == name else f"{eff} (asked {name})"
            covered = (d.time.max() - d.time.min()).days
            print(f"    {tag:>14}: {len(d):>7,} bars   "
                  f"{d.time.min()} -> {d.time.max()}  ({covered}d)", flush=True)
            return d, eff

        print(f"[*] Pulling {self.days} days of {sym}\u2026", flush=True)
        ltf, self.ltf_name = grab(config.TIMEFRAME_LTF)
        i4h, _ = grab("4H")
        d1, _ = grab("1D")

        if self.ltf_name != config.TIMEFRAME_LTF and ltf is not None:
            print(f"[i] {sym} has no {config.TIMEFRAME_LTF} bars on this broker \u2014 "
                  f"entries were timed on {self.ltf_name} instead.", flush=True)

        # How much of the requested window actually came back. A broker that
        # only keeps 90 days of intraday history still gives a usable test;
        # reporting 90 days as though it were 365 does not.
        if ltf is not None and len(ltf):
            self.covered_days = int((ltf.time.max() - ltf.time.min()).days)
            if self.covered_days < self.days * 0.75:
                print(f"[!] Only {self.covered_days} of the {self.days} days requested "
                      f"are on this account. Results below cover that window, "
                      f"not a full year.", flush=True)

        # Broker server-time offset. Bars are stamped in server time; every
        # playbook session rule is written in UTC. Without this the backtest
        # gates on the wrong hours of the day, and \u2014 worse \u2014 on DIFFERENT hours
        # than the live engine if the two ever disagree about the offset.
        self.utc_offset = 0.0
        try:
            tick = mt5.symbol_info_tick(sym)
            if tick is not None and tick.time:
                import time as _t
                self.utc_offset = round(((float(tick.time) - _t.time()) / 3600.0) * 2) / 2
        except Exception:
            pass
        print(f"    broker server time is UTC{self.utc_offset:+g} \u2014 "
              f"session rules adjusted accordingly", flush=True)

        mt5.shutdown()

        missing = [n for n, x in (("LTF", ltf), ("4H", i4h), ("1D", d1))
                   if x is None]
        if missing:
            print(f"[!] Cannot run: {', '.join(missing)} came back empty even after "
                  f"falling back. Open {sym} in a MetaTrader chart, scroll left to "
                  f"force the history download, then run this again.", flush=True)
            return None
        return ltf, i4h, d1

    # -- simulation ---------------------------------------------------------

    def simulate(self, df: pd.DataFrame, df15: pd.DataFrame, strategy: str,
                 df_htf: Optional[pd.DataFrame] = None) -> List[Dict]:
        engine = SignalEngine()
        # 4H is folded up from the 1H frame rather than fetched separately, so a
        # backtest sees the same zone pool the live chart does.
        htf = {}
        if df_htf is not None and len(df_htf) > 5:
            htf = {"1H": df_htf, "4H": resample_ohlc(df_htf, "4h")}
        
        # Support and resistance is read off the 1H frame. Falling back to the
        # 15M frame keeps older callers working rather than silently running
        # with no levels at all.
        engine.prepare_sr(df_htf if df_htf is not None else df15)
        guard = risk.SessionGuard()

        open_trades: List[Dict] = []
        closed: List[Dict] = []
        rejects: Dict[str, int] = {}
        last_signal_idx = -999
        n = len(df)

        for i in range(50, n):
            row = df.iloc[i]
            hi, lo, t = float(row["high"]), float(row["low"]), row["time"]
            # Session discipline resets on the UTC day, matching the live guard.
            when = (row["utc_time"] if "utc_time" in row else t) \
                .to_pydatetime().replace(tzinfo=timezone.utc)

            # ---- manage open trades ----------------------------------------
            still: List[Dict] = []
            for tr in open_trades:
                tr["bars_held"] += 1
                buy = tr["type"] == "BUY"
                fav = (hi - tr["entry_price"]) if buy else (tr["entry_price"] - lo)
                adv = (tr["entry_price"] - lo) if buy else (hi - tr["entry_price"])
                tr["mfe_usd"] = max(tr["mfe_usd"], fav)
                tr["mae_usd"] = max(tr["mae_usd"], adv)

                # Cost-to-Cost — breakeven plus spread
                if not tr["ctc_applied"] and fav >= tr["ctc_trigger_usd"]:
                    tr["sl"] = tr["ctc_price"]
                    tr["ctc_applied"] = True

                # TP1 — bank the partial, then trail
                if not tr["tp1_hit"]:
                    reached = hi >= tr["tp1"] if buy else lo <= tr["tp1"]
                    if reached:
                        closed_lots = tr["lots"] * config.TP1_PARTIAL_CLOSE_PCT
                        move = (tr["tp1"] - tr["entry_price"]) if buy else (tr["entry_price"] - tr["tp1"])
                        tr["pnl_usd"] += (move - self.spread) * closed_lots * risk.USD_PER_PRICE_UNIT_PER_LOT
                        tr["remaining_lots"] = tr["lots"] - closed_lots
                        tr["tp1_hit"] = True
                        if not tr["ctc_applied"]:
                            tr["sl"] = tr["ctc_price"]
                            tr["ctc_applied"] = True

                # Post-TP1 trail to the 3M swing anchor
                if tr["tp1_hit"] and config.TRAIL_AFTER_TP1:
                    if buy:
                        sw = trailing_swing_low(df, i, config.TRAIL_SWING_LOOKBACK_BARS)
                        if sw is not None:
                            tr["sl"] = max(tr["sl"], sw - config.TRAIL_BUFFER_USD)
                    else:
                        sw = trailing_swing_high(df, i, config.TRAIL_SWING_LOOKBACK_BARS)
                        if sw is not None:
                            tr["sl"] = min(tr["sl"], sw + config.TRAIL_BUFFER_USD)

                # ---- exits -------------------------------------------------
                exit_px = exit_reason = None
                if buy:
                    if hi >= tr["tp2"]:
                        exit_px, exit_reason = tr["tp2"], "TP2 Reached"
                    elif lo <= tr["sl"]:
                        exit_px = tr["sl"]
                        exit_reason = "CTC Breakeven Exit" if tr["ctc_applied"] else "Hard SL Hit"
                else:
                    if lo <= tr["tp2"]:
                        exit_px, exit_reason = tr["tp2"], "TP2 Reached"
                    elif hi >= tr["sl"]:
                        exit_px = tr["sl"]
                        exit_reason = "CTC Breakeven Exit" if tr["ctc_applied"] else "Hard SL Hit"

                if exit_px is None and tr["bars_held"] >= config.MAX_BAR_HOLDING_LTF:
                    exit_px, exit_reason = float(row["close"]), "Time Exit"

                if exit_px is None:
                    still.append(tr)
                    continue

                move = (exit_px - tr["entry_price"]) if buy else (tr["entry_price"] - exit_px)
                tr["pnl_usd"] += (move - self.spread) * tr["remaining_lots"] * risk.USD_PER_PRICE_UNIT_PER_LOT
                tr["exit_price"] = round(exit_px, config.PRICE_DECIMALS)
                tr["exit_time"] = t.strftime("%Y-%m-%d %H:%M")
                tr["exit_reason"] = exit_reason
                tr["pnl_usd"] = round(tr["pnl_usd"], 2)
                tr["outcome"] = metrics.classify(tr["pnl_usd"], tr["risk_usd_total"], exit_reason)
                tr["r_multiple"] = round(tr["pnl_usd"] / tr["risk_usd_total"], 3) if tr["risk_usd_total"] else None
                tr["mfe_pips"] = round(config.to_pips(tr.pop("mfe_usd")), 1)
                tr["mae_pips"] = round(config.to_pips(tr.pop("mae_usd")), 1)
                closed.append(tr)
                guard.record_exit(tr["outcome"], when)

            open_trades = still

            # ---- look for a new signal -------------------------------------
            gate = guard.can_trade(when, open_positions=len(open_trades))
            if not gate["allowed"]:
                rejects[gate["code"]] = rejects.get(gate["code"], 0) + 1
                continue
            if i - last_signal_idx < config.SIGNAL_COOLDOWN_BARS:
                continue

            sig = engine.evaluate_bar(df, i, strategy=strategy)
            
            ts_str = t.strftime("%Y-%m-%d %H:%M")
            if "2026-08-25" in ts_str and "13:48" in ts_str and strategy == SWING_CORE:
                print(f"[DEBUG 13:48] sig: {sig}, reject: {engine.last_reject}")
                
            if sig is None:
                why = (engine.last_reject or "no setup").split("—")[0].split(".")[0].strip()[:64]
                rejects[why] = rejects.get(why, 0) + 1
                continue

            last_signal_idx = i
            risk_usd = sig["risk_usd"]
            open_trades.append({
                "id": len(closed) + len(open_trades) + 1,
                "strategy": strategy,
                "strategy_label": "Core SMC" if strategy == SWING_CORE else "Swing Pro",
                "strategy_fingerprint": sig["strategy_fingerprint"],
                "type": sig["type"],
                "entry_time": t.strftime("%Y-%m-%d %H:%M"),
                "entry_hour": int(row["time"].hour),
                "entry_hour_utc": int(row.get("utc_hour", row["time"].hour)),
                "session_name": self.session_name(float(row["time"].hour + row["time"].minute / 60.0)),
                "entry_price": sig["entry_price"],
                "sl": sig["sl"], "tp1": sig["tp1"], "tp2": sig["tp2"],
                "ctc_price": sig["ctc_sl_price"],
                "ctc_trigger_usd": sig["ctc_trigger_usd"],
                "risk_usd": risk_usd,
                "risk_pips": sig["risk_pips"],
                "risk_usd_total": round(risk_usd * risk.USD_PER_PRICE_UNIT_PER_LOT * self.lots, 2),
                "tp1_rr": sig["tp1_rr"], "tp2_rr": sig["tp2_rr"],
                "lots": self.lots, "remaining_lots": self.lots,
                "pnl_usd": 0.0,
                "daily_bias": sig["daily_bias"],
                "poi_type": sig["poi_type"],
                "poi_retests": sig.get("poi_retests", 0),
                "rejection_wick_pct": sig["rejection_wick_pct"],
                "confluence_score": sig.get("confluence_score"),
                "atr_at_entry": round(float(row["atr"]), 3) if not pd.isna(row["atr"]) else None,
                "bars_held": 0, "tp1_hit": False, "ctc_applied": False,
                "mfe_usd": 0.0, "mae_usd": 0.0,
                "exit_price": None, "exit_time": None, "exit_reason": None,
                "outcome": None, "r_multiple": None,
                "reasons": " | ".join(sig["reasons"]),
            })
            guard.record_entry(when)

        self.last_rejects = dict(sorted(rejects.items(), key=lambda kv: -kv[1])[:12])
        return closed

    @staticmethod
    def session_name(hf: float) -> str:
        if 0 <= hf < 6: return "ASIAN"
        if 6 <= hf < 7.5: return "PRE_LONDON"
        if 7.5 <= hf < 12: return "LONDON"
        if 12 <= hf < 16: return "NEW_YORK_OVERLAP"
        if 16 <= hf < 21: return "NEW_YORK"
        return "ROLLOVER"

    # -- run ----------------------------------------------------------------

    def run(self, strategies: List[str]) -> Dict:
        data = self.fetch()
        if data is None:
            return {}
        ltf, i4h, d1 = data

        print("[*] Preparing indicators…", flush=True)
        df = prepare_dataframe(ltf, i4h, d1)

        out = {}
        for strat in strategies:
            label = "Core SMC" if strat == SWING_CORE else "Swing Pro"
            print(f"\n[*] Simulating {label}…", flush=True)
            trades = self.simulate(df, d1, strat)
            summary = metrics.summarize(trades, strat, label)
            out[strat] = {"summary": summary, "trades": trades, "rejects": self.last_rejects}

            fname = ("swing_core_backtest_trades.csv" if strat == SWING_CORE
                     else "swing_pro_backtest_trades.csv")
            path = os.path.join(DATA_DIR, fname)
            if trades:
                pd.DataFrame(trades).to_csv(path, index=False)
                print(f"    wrote {len(trades):,} trades -> {fname}", flush=True)
            else:
                pd.DataFrame(columns=["id", "strategy", "entry_time"]).to_csv(path, index=False)
                print(f"    no trades generated -> {fname} (empty)", flush=True)

            self.report(summary, self.last_rejects)

        with open(os.path.join(DATA_DIR, "backtest_meta.json"), "w") as f:
            json.dump({
                "generated": datetime.now().isoformat(),
                "engine_fingerprint": config.strategy_fingerprint(),
                "days": self.days, "lots": self.lots, "symbol": self.symbol,
                "spread_usd": self.spread,
                "entry_timeframe": self.ltf_name,
                "days_covered": self.covered_days,
                "broker_utc_offset": self.utc_offset,
                "summaries": {k: v["summary"] for k, v in out.items()},
            }, f, indent=2, default=str)

        return out

    @staticmethod
    def report(s: Dict, rejects: Dict) -> None:
        if s.get("empty"):
            print("    No trades. Top reasons setups were declined:", flush=True)
            for k, v in list(rejects.items())[:8]:
                print(f"      {v:>6,}  {k}", flush=True)
            return

        line = "    " + "-" * 62
        print(line, flush=True)
        print(f"    Period            {s['period_start']} -> {s['period_end']}  "
              f"({s['period_months']} months)", flush=True)
        print(f"    Trades            {s['total_trades']:,}   "
              f"({s['trades_per_month']}/month)", flush=True)
        print(f"    Wins              {s['wins']:,}  ({s['win_rate']}%)", flush=True)
        print(f"    Breakeven exits   {s['breakevens']:,}  ({s['breakeven_rate']}%)   "
              f"<- not counted as wins", flush=True)
        print(f"    Losses            {s['losses']:,}  ({s['loss_rate']}%)", flush=True)
        print(line, flush=True)
        print(f"    NET               ${s['net_usd']:>12,.2f}   "
              f"({'PROFITABLE' if s['is_profitable'] else 'LOSING'})", flush=True)
        print(f"    Per month         ${s['net_usd_per_month']:>12,.2f}", flush=True)
        print(f"    Expectancy        {s['expectancy_r']:>12.3f} R   "
              f"(${s['expectancy_usd']}/trade)", flush=True)
        print(f"    Profit factor     {s['profit_factor']:>12.2f}   "
              f"(excl. breakeven {s['profit_factor_excluding_breakeven']})", flush=True)
        print(f"    Avg win / loss    ${s['avg_win_usd']:,.2f} / ${s['avg_loss_usd']:,.2f}", flush=True)
        print(f"    Worst loss        ${s['largest_loss_usd']:,.2f}", flush=True)
        print(f"    Max drawdown      ${s['max_drawdown_usd']:,.2f}", flush=True)
        print(line, flush=True)
        if rejects:
            print("    Most common reasons a setup was declined:", flush=True)
            for k, v in list(rejects.items())[:6]:
                print(f"      {v:>6,}  {k}", flush=True)
        print(flush=True)


def main():
    p = argparse.ArgumentParser(description="MyTradingView backtester")
    p.add_argument("--days", "-d", type=int, default=365)
    p.add_argument("--lots", "-l", type=float, default=0.10)
    p.add_argument("--strategy", "-s", default="both",
                   choices=["both", "swing", "custom"])
    a = p.parse_args()

    strategies = ({"both": [SWING_CORE, SWING_PRO],
                   "swing": [SWING_CORE],
                   "custom": [SWING_PRO]})[a.strategy]

    print("=" * 70, flush=True)
    print("  MY FINANCE ADVISOR — BACKTEST", flush=True)
    print(f"  Engine fingerprint: {config.strategy_fingerprint()}", flush=True)
    print(f"  {a.days} days · {a.lots} lots · spread ${config.TYPICAL_SPREAD_USD:.2f}", flush=True)
    print(f"  Session {config.SESSION_WINDOWS_UTC} UTC · "
          f"stop ${config.SL_MIN_DISTANCE_USD:.0f}-${config.SL_MAX_DISTANCE_USD:.0f} · "
          f"CTC +{config.to_pips(config.CTC_TRIGGER_USD):.0f} pips", flush=True)
    print("=" * 70, flush=True)

    res = Backtester(days=a.days, lots=a.lots).run(strategies)
    if not res:
        sys.exit(1)

    print("\nDone. Open the Analytics page and press Reload to see these numbers.", flush=True)


if __name__ == "__main__":
    main()
