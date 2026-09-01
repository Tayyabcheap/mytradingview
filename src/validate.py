"""
Walk-forward validation.
========================

Why this file exists
--------------------
Tuning parameters on a sample and then reporting that sample's profit is not a
test. It is the definition of curve-fitting: with ten knobs and one 119-day
window, some combination will always look excellent, and it will keep looking
excellent right up until it is traded.

This runs the honest version instead:

    fold 1   [--- train 60d ---][- test 30d -]
    fold 2              [--- train 60d ---][- test 30d -]
    fold 3                         [--- train 60d ---][- test 30d -]
    ...

Parameters are chosen on `train` and scored on `test`, which the chooser never
saw. Only the concatenated test results are reported. Two questions get answered:

    1. Does the strategy make money on data it was not fitted to?
    2. Does tuning beat leaving the parameters alone?

If (2) is "no" — and it usually is — then optimisation is adding variance, not
edge, and the right move is to stop turning knobs.

    python validate.py --days 365
    python validate.py --days 365 --train 90 --test 30
    python validate.py --days 365 --baseline-only      (no tuning, just stability)
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import sys
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

import config
import metrics
from backtester import Backtester
from indicators import prepare_dataframe
from signal_engine import SWING_PRO, SWING_CORE

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(BASE_DIR), "data")


# ---------------------------------------------------------------------------
# The grid. Deliberately small.
# ---------------------------------------------------------------------------
# Every extra axis multiplies the number of ways to get lucky. Five parameters
# with three values each is 243 combinations against ~150 training trades — that
# is already generous. Adding a sixth axis would mean testing more hypotheses
# than there are trades to test them on.
GRID: Dict[str, list] = {
    "MIN_REJECTION_WICK_RATIO": [0.15, 0.25, 0.35],
    "SL_MIN_DISTANCE_USD":      [3.0, 4.0, 5.0],
    "TP1_MIN_RR":               [1.0, 1.5, 2.0],
    "CTC_TRIGGER_USD":          [3.0, 5.0, 50.0],     # 50.0 == effectively off
    "SIGNAL_COOLDOWN_BARS":     [2, 6, 12],
}

MIN_TRAIN_TRADES = 40      # below this a fold's "best" parameters are noise


def _apply(overrides: Dict) -> Dict:
    prev = {k: getattr(config, k) for k in overrides}
    for k, v in overrides.items():
        setattr(config, k, v)
    return prev


def _score(trades: List[Dict]) -> Tuple[float, int]:
    """Expectancy in R, and the trade count it rests on."""
    rs = [t["r_multiple"] for t in trades if t.get("r_multiple") is not None]
    return (float(np.mean(rs)) if rs else -9.9), len(rs)


def _slice(df: pd.DataFrame, start, end) -> pd.DataFrame:
    m = (df["time"] >= start) & (df["time"] < end)
    return df.loc[m].reset_index(drop=True)


def _run(bt: Backtester, df: pd.DataFrame, df15: pd.DataFrame, strat: str,
         df_htf=None) -> List[Dict]:
    try:
        return bt.simulate(df, df15, strat, df_htf=df_htf)
    except Exception as e:                       # a bad combination must not kill the sweep
        print(f"      ! {type(e).__name__}: {e}", flush=True)
        return []


def walk_forward(bt, df, df15, strat, train_days, test_days, tune=True) -> Dict:
    t0, t1 = df["time"].min(), df["time"].max()
    step = pd.Timedelta(days=test_days)
    train = pd.Timedelta(days=train_days)

    folds, oos_tuned, oos_base = [], [], []
    combos = [dict(zip(GRID, v)) for v in itertools.product(*GRID.values())] if tune else []

    cursor = t0 + train
    fold_no = 0
    while cursor + step <= t1:
        fold_no += 1
        tr = _slice(df, cursor - train, cursor)
        te = _slice(df, cursor, cursor + step)
        label = f"  fold {fold_no}  train {str(cursor - train)[:10]}→{str(cursor)[:10]}  " \
                f"test {str(cursor)[:10]}→{str(cursor + step)[:10]}"

        # --- baseline: the parameters already in config.py, untouched --------
        base_trades = _run(bt, te, df15, strat)
        b_exp, b_n = _score(base_trades)
        oos_base.extend(base_trades)

        best_over, best_exp, best_n = None, -9.9, 0
        if tune:
            for combo in combos:
                prev = _apply(combo)
                try:
                    e, n = _score(_run(bt, tr, df15, strat))
                finally:
                    _apply(prev)
                if n >= MIN_TRAIN_TRADES and e > best_exp:
                    best_over, best_exp, best_n = combo, e, n

            if best_over is not None:
                prev = _apply(best_over)
                try:
                    tuned_trades = _run(bt, te, df15, strat)
                finally:
                    _apply(prev)
                oos_tuned.extend(tuned_trades)
                t_exp, t_n = _score(tuned_trades)
            else:
                t_exp, t_n = float("nan"), 0

            print(f"{label}\n"
                  f"      train best {best_exp:+.3f}R on {best_n} trades  "
                  f"{ {k: v for k, v in (best_over or {}).items()} }\n"
                  f"      OOS tuned  {t_exp:+.3f}R on {t_n:>3} trades   "
                  f"OOS baseline {b_exp:+.3f}R on {b_n:>3} trades", flush=True)
        else:
            print(f"{label}\n      OOS baseline {b_exp:+.3f}R on {b_n:>3} trades", flush=True)

        folds.append({"fold": fold_no, "test_from": str(cursor)[:10],
                      "baseline_exp_r": None if np.isnan(b_exp) else round(b_exp, 4),
                      "baseline_trades": b_n,
                      "tuned_exp_r": None if not tune or np.isnan(t_exp) else round(t_exp, 4),
                      "tuned_trades": t_n if tune else 0,
                      "chosen": best_over})
        cursor += step

    return ({"folds": folds,
             "oos_baseline": metrics.summarize(oos_base, strat, "OOS baseline"),
             "oos_tuned": metrics.summarize(oos_tuned, strat, "OOS tuned") if tune else None},
            {"baseline": oos_base, "tuned": oos_tuned})


def bootstrap_ci(trades: List[Dict], n=8000, seed=3) -> Tuple[float, float, float, float]:
    rs = np.array([t["r_multiple"] for t in trades if t.get("r_multiple") is not None])
    if len(rs) < 20:
        return (np.nan,) * 4
    rng = np.random.default_rng(seed)
    s = rng.choice(rs, (n, len(rs)), replace=True).mean(axis=1)
    return float(rs.mean()), float(np.percentile(s, 2.5)), float(np.percentile(s, 97.5)), float((s <= 0).mean())


def main() -> int:
    p = argparse.ArgumentParser(description="Walk-forward validation")
    p.add_argument("--days", "-d", type=int, default=365)
    p.add_argument("--train", type=int, default=60)
    p.add_argument("--test", type=int, default=30)
    p.add_argument("--strategy", "-s", default="swing", choices=["swing", "custom"])
    p.add_argument("--baseline-only", action="store_true",
                   help="skip tuning; just show whether the current settings hold up month to month")
    a = p.parse_args()

    strat = SWING_CORE if a.strategy == "swing" else SWING_PRO

    print("=" * 74)
    print("  WALK-FORWARD VALIDATION")
    print(f"  engine {config.strategy_fingerprint()} · train {a.train}d / test {a.test}d "
          f"· {'baseline only' if a.baseline_only else f'{np.prod([len(v) for v in GRID.values()])} combinations per fold'}")
    print("=" * 74, flush=True)

    bt = Backtester(days=a.days)
    data = bt.fetch()
    if data is None:
        return 1
    ltf, i15, h1, d1 = data
    df = prepare_dataframe(ltf, i15, d1, h1, utc_offset_hours=getattr(bt, "utc_offset", 0.0))
    print(f"[*] {len(df):,} {bt.ltf_name} bars, {str(df.time.min())[:10]} → {str(df.time.max())[:10]}\n", flush=True)

    res, oos_lists = walk_forward(bt, df, i15, strat, a.train, a.test, tune=not a.baseline_only)

    print("\n" + "=" * 74)
    print("  OUT-OF-SAMPLE RESULT — the only numbers that mean anything")
    print("=" * 74)
    for name, key in (("baseline (config.py as-is)", "oos_baseline"), ("tuned each fold", "oos_tuned")):
        s = res.get(key)
        if not s or s.get("empty"):
            continue
        print(f"\n  {name}")
        print(f"    trades {s['total_trades']:<6} net ${s['net_usd']:>10,.0f}   PF {s['profit_factor']:.2f}   "
              f"win {s['win_rate']:.1f}% vs {s['breakeven_win_rate']:.1f}% needed")
        print(f"    expectancy {s['expectancy_r']:+.3f}R   max drawdown ${s['max_drawdown_usd']:,.0f}")
        mean, lo, hi, p0 = bootstrap_ci(oos_lists["baseline" if key == "oos_baseline" else "tuned"])
        if not np.isnan(mean):
            print(f"    bootstrap  {mean:+.3f}R  95% CI [{lo:+.3f}, {hi:+.3f}]   "
                  f"probability the true edge is <= 0: {p0*100:.1f}%")
            if p0 > 0.05:
                print(f"    ^ that is not a demonstrated edge. Do not size up on it.")

    # Verdict
    print()
    b, t = res["oos_baseline"], res.get("oos_tuned")
    if t and not t.get("empty") and not b.get("empty"):
        delta = t["expectancy_r"] - b["expectancy_r"]
        print("  " + "-" * 70)
        if delta <= 0.02:
            print(f"  VERDICT: tuning changed out-of-sample expectancy by {delta:+.3f}R — "
                  f"nothing.\n           The knobs are fitting noise. Stop turning them and "
                  f"trade the baseline.")
        else:
            print(f"  VERDICT: tuning added {delta:+.3f}R out of sample across "
                  f"{len(res['folds'])} folds.\n           That is worth keeping, but re-run this "
                  f"before trusting any new setting.")
        print("  " + "-" * 70)

    with open(os.path.join(DATA_DIR, "walk_forward_report.json"), "w") as f:
        json.dump(res, f, indent=2, default=str)
    print("\n  wrote walk_forward_report.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
