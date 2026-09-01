"""
Statistical acceptance tests for a set of trades.
=================================================

Four questions, asked properly:

    Sharpe            is the return worth the variance?
    Significance      could a strategy with no edge have produced this?
    Robustness        what does the bad version of this look like?
    Ruin              can the account survive the bad version?

Everything here works on a finished trade list, so it runs in seconds against
the backtest CSV without touching MetaTrader. Nothing here can tell you whether
the parameters were fitted — only walk-forward can, and that lives in
validate.py. A strategy can pass every test on this page and still be curve-fit.

    python stats.py                          the newest backtest CSV
    python stats.py --file swing_core_backtest_trades.csv --balance 5000
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(BASE_DIR), "data")

TRADING_DAYS = 252
SHARPE_TARGET = 1.5
ALPHA = 0.05


# ---------------------------------------------------------------------------
# Sharpe
# ---------------------------------------------------------------------------

def sharpe(daily: np.ndarray, periods: int = TRADING_DAYS) -> float:
    """Annualised Sharpe on daily P&L. Risk-free rate omitted deliberately —
    these are R multiples and unlevered dollar returns on a fixed stake, not
    a funded portfolio return series."""
    daily = np.asarray(daily, dtype=float)
    if len(daily) < 3:
        return float("nan")
    sd = daily.std(ddof=1)
    if sd <= 0:
        return float("nan")
    return float(daily.mean() / sd * math.sqrt(periods))


def sharpe_stderr(sr: float, n: int) -> float:
    """
    Standard error of an estimated Sharpe ratio (Lo, 2002).

    A Sharpe measured over 86 days is not the same object as one measured over
    ten years, and quoting it without this is how a number like 7.7 gets taken
    seriously.
    """
    if n < 3 or not np.isfinite(sr):
        return float("nan")
    return math.sqrt((1.0 + 0.5 * sr * sr) / n)


def deflated_sharpe(sr: float, n: int, trials: int) -> float:
    """
    Sharpe haircut for the number of configurations tried.

    Searching a grid guarantees a good-looking best. The expected maximum
    Sharpe of `trials` independent worthless strategies is roughly
    SE * sqrt(2 ln trials); subtracting it answers "is this better than the
    best random result I was always going to find?"
    """
    if trials <= 1 or not np.isfinite(sr):
        return sr
    se = sharpe_stderr(sr, n)
    return float(sr - se * math.sqrt(2.0 * math.log(trials)))


# ---------------------------------------------------------------------------
# Significance
# ---------------------------------------------------------------------------

def bootstrap_mean(x: np.ndarray, n: int = 20000, seed: int = 17) -> Dict:
    rng = np.random.default_rng(seed)
    x = np.asarray(x, dtype=float)
    if len(x) < 20:
        return {"mean": float(x.mean()) if len(x) else float("nan"),
                "lo": float("nan"), "hi": float("nan"), "p_le_zero": float("nan"), "n": len(x)}
    s = rng.choice(x, (n, len(x)), replace=True).mean(axis=1)
    return {"mean": float(x.mean()), "lo": float(np.percentile(s, 2.5)),
            "hi": float(np.percentile(s, 97.5)), "p_le_zero": float((s <= 0).mean()), "n": len(x)}


def permutation_test(x: np.ndarray, n: int = 20000, seed: int = 23) -> Dict:
    """
    Bootstrap test of H0: mean R = 0.

    The null is built by centring the observed returns, which keeps the real
    shape of the distribution — the fat left tail from full stop-outs and the
    cluster near +0.75R from partial exits — and asks only whether the location
    could be zero. A normal t-test would assume a symmetry these returns do not
    have.
    """
    rng = np.random.default_rng(seed)
    x = np.asarray(x, dtype=float)
    if len(x) < 20:
        return {"p": float("nan"), "observed": float("nan"), "n": len(x)}
    obs = float(x.mean())
    null = x - obs
    sims = rng.choice(null, (n, len(x)), replace=True).mean(axis=1)
    return {"p": float((sims >= obs).mean()), "observed": obs,
            "null_p95": float(np.percentile(sims, 95)), "n": len(x)}


def runs_test(x: np.ndarray) -> Dict:
    """
    Wald-Wolfowitz runs test for serial dependence in the win/loss sequence.

    It matters because every confidence interval on this page assumes trades
    are independent. If wins arrive in streaks, the real intervals are wider
    than the ones reported and the edge is less certain than it looks.
    """
    b = np.asarray(x, dtype=float) > 0
    n1, n0 = int(b.sum()), int((~b).sum())
    if n1 < 10 or n0 < 10:
        return {"z": float("nan"), "p": float("nan"), "runs": 0}
    runs = 1 + int((b[1:] != b[:-1]).sum())
    n = n1 + n0
    mu = 2 * n1 * n0 / n + 1
    var = (2 * n1 * n0 * (2 * n1 * n0 - n)) / (n * n * (n - 1))
    if var <= 0:
        return {"z": float("nan"), "p": float("nan"), "runs": runs}
    z = (runs - mu) / math.sqrt(var)
    p = 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))
    return {"z": float(z), "p": float(p), "runs": runs, "expected_runs": float(mu)}


# ---------------------------------------------------------------------------
# Monte Carlo
# ---------------------------------------------------------------------------

def _curve_stats(seq: np.ndarray) -> Tuple[float, float, int]:
    eq = np.cumsum(seq)
    peak = np.maximum.accumulate(eq)
    dd = float((peak - eq).max())
    # longest run of losses
    worst = cur = 0
    for v in seq:
        cur = cur + 1 if v < 0 else 0
        worst = max(worst, cur)
    return float(eq[-1]), dd, worst


def monte_carlo(pnl: np.ndarray, n: int = 5000, block: int = 1, seed: int = 31) -> Dict:
    """
    Resample the trade sequence to see the runs that did not happen.

    `block` > 1 draws contiguous blocks instead of single trades, preserving
    whatever streakiness is in the data. Independent resampling of a streaky
    series understates drawdown, which is the number that decides whether an
    account survives.
    """
    rng = np.random.default_rng(seed)
    pnl = np.asarray(pnl, dtype=float)
    m = len(pnl)
    if m < 30:
        return {}

    finals, dds, streaks = np.empty(n), np.empty(n), np.empty(n, dtype=int)
    if block <= 1:
        idx = rng.integers(0, m, (n, m))
        for i in range(n):
            finals[i], dds[i], streaks[i] = _curve_stats(pnl[idx[i]])
    else:
        nb = int(np.ceil(m / block))
        starts = rng.integers(0, max(1, m - block), (n, nb))
        for i in range(n):
            seq = np.concatenate([pnl[s:s + block] for s in starts[i]])[:m]
            finals[i], dds[i], streaks[i] = _curve_stats(seq)

    q = lambda a, p: float(np.percentile(a, p))
    return {
        "runs": n, "block": block, "trades": m,
        "net_p5": q(finals, 5), "net_p50": q(finals, 50), "net_p95": q(finals, 95),
        "p_losing_run": float((finals <= 0).mean()),
        "dd_p50": q(dds, 50), "dd_p95": q(dds, 95), "dd_worst": float(dds.max()),
        "streak_p95": int(np.percentile(streaks, 95)), "streak_worst": int(streaks.max()),
    }


def risk_of_ruin(r_multiples: np.ndarray, balance: float, risk_pct: float,
                 trades: int = 500, n: int = 5000, ruin_frac: float = 0.5,
                 seed: int = 37) -> Dict:
    """
    Compound the R distribution at a fixed fractional risk and count how often
    the account halves. Fixed-fractional sizing is what the app does, so the
    stake shrinks after losses — which is exactly why ruin is rarer than a
    fixed-stake model suggests, and why the drawdown lasts longer.
    """
    rng = np.random.default_rng(seed)
    r = np.asarray(r_multiples, dtype=float)
    if len(r) < 30 or balance <= 0:
        return {}
    draws = rng.choice(r, (n, trades), replace=True)
    ruined = 0
    finals = np.empty(n)
    floor = balance * ruin_frac
    for i in range(n):
        eq = balance
        low = balance
        for x in draws[i]:
            eq += eq * (risk_pct / 100.0) * x
            low = min(low, eq)
            if eq <= floor:
                break
        finals[i] = eq
        if low <= floor:
            ruined += 1
    return {
        "balance": balance, "risk_pct": risk_pct, "trades": trades,
        "p_ruin": ruined / n,
        "final_p5": float(np.percentile(finals, 5)),
        "final_p50": float(np.percentile(finals, 50)),
        "final_p95": float(np.percentile(finals, 95)),
    }


# ---------------------------------------------------------------------------
# Execution cost
# ---------------------------------------------------------------------------

USD_PER_PIP_PER_LOT = 10.0          # 0.10 lots of gold: 1 pip = $1.00 of P&L


def slippage_sensitivity(df: pd.DataFrame, pips=(0, 1, 2, 3, 5, 8, 12)) -> List[Dict]:
    """
    How many pips of slippage does the edge survive?

    This is the test a high-frequency strategy fails in the real world while
    passing every statistical test on this page. A backtest fills at the exact
    close of a 3-minute bar. A broker does not: there is latency, the spread
    widens around news and at the session roll, and a stop is filled at
    whatever is available rather than at the price on the chart.

    The arithmetic is unforgiving. Expectancy per trade is a fixed number of
    dollars; slippage is a fixed cost per trade. Double the trade count at the
    same net profit and you have halved the cost each trade can absorb — which
    is why trade selection matters more than trade frequency, and why a
    strategy that takes every candidate is fragile even when it is profitable.
    """
    out = []
    n = len(df)
    if not n:
        return out
    lots = float(df["lots"].median()) if "lots" in df else 0.10
    per_pip = USD_PER_PIP_PER_LOT * (lots / 0.10)
    gross = float(df["pnl_usd"].sum())
    risk = float(df["risk_usd"].median()) if "risk_usd" in df else 8.0

    for p in pips:
        cost = p * per_pip * n                      # round-trip pips, all trades
        net = gross - cost
        out.append({
            "pips": p,
            "cost_per_trade": p * per_pip,
            "total_cost": cost,
            "net": net,
            "expectancy_usd": net / n,
            "expectancy_r": (net / n) / (risk * 10.0 * (lots / 0.10)) if risk else float("nan"),
            "survives": net > 0,
        })
    return out


def breakeven_slippage(df: pd.DataFrame) -> float:
    """Pips of round-trip slippage that reduce the edge to exactly zero."""
    n = len(df)
    if not n:
        return float("nan")
    lots = float(df["lots"].median()) if "lots" in df else 0.10
    per_pip = USD_PER_PIP_PER_LOT * (lots / 0.10)
    return float(df["pnl_usd"].sum()) / (per_pip * n)


# ---------------------------------------------------------------------------
# Walk-forward over trade selection
# ---------------------------------------------------------------------------
#
# validate.py re-runs the whole engine per parameter set and needs MetaTrader.
# This is the cheaper half of the same question, and it is the half that matters
# most here: given the signals the engine already produced, does CHOOSING among
# them beat taking all of them — on trades the chooser has not seen?
#
# Only structural filters are offered. Each one is a property of the setup that
# was knowable at entry and describes a different kind of trade, not a threshold
# tuned to this sample. A grid of numeric cutoffs would find something in any
# data set; a short list of categories is much harder to fool.

FILTERS = {
    "take everything":       lambda d: pd.Series(True, index=d.index),
    "first tap of a zone":   lambda d: d.poi_retests == 1,
    "order blocks only":     lambda d: d.poi_type.str.contains("OB", na=False),
    "OB, first tap":         lambda d: (d.poi_retests == 1) & d.poi_type.str.contains("OB", na=False),
    "trending bias only":    lambda d: d.daily_bias.isin(["STRONG_BULLISH", "STRONG_BEARISH"]),
    "OB first tap + trend":  lambda d: ((d.poi_retests == 1)
                                        & d.poi_type.str.contains("OB", na=False)
                                        & d.daily_bias.isin(["STRONG_BULLISH", "STRONG_BEARISH"])),
}

MIN_TRAIN = 40


def walk_forward_filters(df: pd.DataFrame, train_days: int = 45,
                         test_days: int = 15) -> Dict:
    tcol = "entry_time" if "entry_time" in df else "time"
    d = df.copy()
    d[tcol] = pd.to_datetime(d[tcol])
    d = d.sort_values(tcol).reset_index(drop=True)

    t0, t1 = d[tcol].min(), d[tcol].max()
    train, step = pd.Timedelta(days=train_days), pd.Timedelta(days=test_days)
    cursor = t0 + train

    folds, picked = [], []
    oos_tuned, oos_base = [], []

    while cursor + step <= t1:
        tr = d[(d[tcol] >= cursor - train) & (d[tcol] < cursor)]
        te = d[(d[tcol] >= cursor) & (d[tcol] < cursor + step)]
        if len(te) == 0:
            cursor += step
            continue

        best, best_exp = None, -9.9
        for name, fn in FILTERS.items():
            g = tr[fn(tr)]
            if len(g) < MIN_TRAIN:
                continue
            e = float(g.r_multiple.mean())
            if e > best_exp:
                best, best_exp = name, e

        base = te
        oos_base.append(base)
        if best is not None:
            sel = te[FILTERS[best](te)]
            oos_tuned.append(sel)
            picked.append(best)
            folds.append({"test_from": str(cursor)[:10], "chose": best,
                          "train_exp": round(best_exp, 3),
                          "oos_tuned_n": len(sel),
                          "oos_tuned_exp": round(float(sel.r_multiple.mean()), 3) if len(sel) else None,
                          "oos_base_n": len(base),
                          "oos_base_exp": round(float(base.r_multiple.mean()), 3)})
        cursor += step

    cat = lambda xs: pd.concat(xs) if xs else pd.DataFrame(columns=d.columns)
    tuned, basel = cat(oos_tuned), cat(oos_base)

    def sm(g):
        if not len(g):
            return {}
        w = g[g.pnl_usd > 0].pnl_usd
        l = g[g.pnl_usd < 0].pnl_usd
        return {"n": len(g), "net": float(g.pnl_usd.sum()),
                "pf": float(w.sum() / abs(l.sum())) if len(l) else 99.0,
                "exp_r": float(g.r_multiple.mean()),
                "sharpe": sharpe(g.groupby(g[tcol].dt.date).pnl_usd.sum().to_numpy())}

    return {"folds": folds, "chosen": picked,
            "oos_tuned": sm(tuned), "oos_baseline": sm(basel),
            "stable": len(set(picked)) == 1 if picked else False}


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

G, R_, Y, DIM, RST = "\033[92m", "\033[91m", "\033[93m", "\033[90m", "\033[0m"


def analyse(df: pd.DataFrame, balance: float = 1000.0, risk_pct: float = 1.0,
            trials: int = 1) -> Dict:
    df = df.copy()
    tcol = "entry_time" if "entry_time" in df else "time"
    df[tcol] = pd.to_datetime(df[tcol])
    df = df.sort_values(tcol).reset_index(drop=True)

    r = df["r_multiple"].dropna().to_numpy(dtype=float)
    pnl = df["pnl_usd"].to_numpy(dtype=float) if "pnl_usd" in df else r
    daily = df.groupby(df[tcol].dt.date)["pnl_usd" if "pnl_usd" in df else "r_multiple"].sum().to_numpy()

    sr = sharpe(daily)
    out = {
        "trades": len(df),
        "days": int(df[tcol].dt.date.nunique()),
        "span_days": int((df[tcol].max() - df[tcol].min()).days),
        "net": float(pnl.sum()),
        "sharpe": sr,
        "sharpe_se": sharpe_stderr(sr, len(daily)),
        "sharpe_deflated": deflated_sharpe(sr, len(daily), trials),
        "bootstrap": bootstrap_mean(r),
        "permutation": permutation_test(r),
        "runs": runs_test(r),
        "mc_iid": monte_carlo(pnl, block=1),
        "mc_block": monte_carlo(pnl, block=10),
        "ruin": risk_of_ruin(r, balance, risk_pct),
        "slippage": slippage_sensitivity(df),
        "walk_forward": walk_forward_filters(df),
        "breakeven_slippage_pips": breakeven_slippage(df),
    }
    return out


def verdict(a: Dict) -> Dict:
    """The four acceptance criteria, each answered yes or no with its reason."""
    sr, se = a["sharpe"], a["sharpe_se"]
    lo = sr - 1.96 * se if np.isfinite(se) else float("nan")
    mc, mcb = a.get("mc_iid") or {}, a.get("mc_block") or {}
    ruin = a.get("ruin") or {}

    checks = {}
    checks["Sharpe >= 1.5"] = {
        "pass": bool(np.isfinite(lo) and lo >= SHARPE_TARGET),
        "detail": (f"{sr:.2f} annualised, 95% CI lower bound {lo:.2f} over {a['days']} trading days"
                   if np.isfinite(lo) else "not enough days to estimate"),
        "note": "the CI lower bound must clear the target, not the point estimate",
    }
    p = a["permutation"]["p"]
    checks["Significance test passed"] = {
        "pass": bool(np.isfinite(p) and p < ALPHA),
        "detail": f"permutation p = {p:.4f} against alpha {ALPHA}" if np.isfinite(p) else "too few trades",
        "note": ("wins are serially dependent, so this p-value is optimistic"
                 if np.isfinite(a["runs"]["p"]) and a["runs"]["p"] < 0.05
                 else "no serial dependence detected in the win/loss sequence"),
    }
    checks["Monte Carlo robust"] = {
        "pass": bool(mcb and mcb.get("p_losing_run", 1) < 0.05
                     and ruin.get("p_ruin", 1) < 0.05),
        "detail": (f"{mcb.get('p_losing_run', float('nan'))*100:.1f}% of block-resampled runs "
                   f"end negative; risk of halving a ${ruin.get('balance', 0):,.0f} account at "
                   f"{ruin.get('risk_pct', 0)}% is {ruin.get('p_ruin', float('nan'))*100:.1f}%"
                   if mcb and ruin else "not enough trades"),
        "note": "block resampling keeps streaks intact, so drawdowns are not understated",
    }
    be = a.get("breakeven_slippage_pips", float("nan"))
    checks["Survives execution cost"] = {
        "pass": bool(np.isfinite(be) and be >= 3.0),
        "detail": f"edge reaches zero at {be:.1f} pips of round-trip slippage",
        "note": "3 pips is a realistic allowance for latency and spread widening on gold",
    }
    wf = a.get("walk_forward") or {}
    t, b = wf.get("oos_tuned") or {}, wf.get("oos_baseline") or {}
    gain = (t.get("exp_r", 0) - b.get("exp_r", 0)) if t and b else float("nan")
    checks["Optimised"] = {
        "pass": bool(t and b and gain > 0.02 and t.get("exp_r", 0) > 0),
        "detail": (f"selection chosen on past folds returned {t.get('exp_r', 0):+.3f}R on unseen "
                   f"trades against {b.get('exp_r', 0):+.3f}R for taking everything "
                   f"({gain:+.3f}R, {len(wf.get('folds', []))} folds)"
                   if t and b else "not enough history to walk forward"),
        "note": ("the same filter won every fold, which is what a real effect looks like"
                 if wf.get("stable") else
                 "the winning filter changed between folds — treat the gain as unstable"),
    }
    return checks


def render(a: Dict, label: str = "") -> bool:
    print(f"\n\033[1mSTATISTICAL ACCEPTANCE{(' — ' + label) if label else ''}\033[0m")
    print(f"{DIM}{a['trades']} trades over {a['span_days']} days ({a['days']} trading days) "
          f"· net ${a['net']:,.0f}{RST}\n")

    sr, se = a["sharpe"], a["sharpe_se"]
    print(f"  Sharpe (annualised, daily P&L)   {sr:>7.2f}")
    if np.isfinite(se):
        print(f"    standard error                 {se:>7.2f}   95% CI "
              f"[{sr - 1.96*se:.2f}, {sr + 1.96*se:.2f}]")
    if a["sharpe_deflated"] != sr:
        print(f"    deflated for search            {a['sharpe_deflated']:>7.2f}")
    b = a["bootstrap"]
    print(f"  Expectancy                       {b['mean']:>+7.3f}R  95% CI "
          f"[{b['lo']:+.3f}, {b['hi']:+.3f}]")
    print(f"  Permutation p-value              {a['permutation']['p']:>7.4f}")
    rt = a["runs"]
    print(f"  Runs test (independence)         z={rt['z']:>6.2f}  p={rt['p']:.3f}   "
          f"{DIM}{rt['runs']} runs vs {rt.get('expected_runs', 0):.0f} expected{RST}")

    for key, m in (("Monte Carlo (i.i.d.)", a["mc_iid"]), ("Monte Carlo (10-trade blocks)", a["mc_block"])):
        if not m:
            continue
        print(f"\n  {key} — {m['runs']:,} resampled histories")
        print(f"    net           p5 ${m['net_p5']:>9,.0f}   median ${m['net_p50']:>9,.0f}   "
              f"p95 ${m['net_p95']:>9,.0f}")
        print(f"    max drawdown  median ${m['dd_p50']:>7,.0f}   p95 ${m['dd_p95']:>7,.0f}   "
              f"worst ${m['dd_worst']:>7,.0f}")
        print(f"    losing streak p95 {m['streak_p95']:>3}      worst {m['streak_worst']:>3}")
        print(f"    {R_ if m['p_losing_run'] >= .05 else G}"
              f"{m['p_losing_run']*100:.1f}% of histories finish negative{RST}")

    ru = a.get("ruin")
    if ru:
        print(f"\n  Risk of ruin — ${ru['balance']:,.0f} account, {ru['risk_pct']}% per trade, "
              f"{ru['trades']} trades")
        print(f"    probability of halving the account: "
              f"{R_ if ru['p_ruin'] >= .05 else G}{ru['p_ruin']*100:.1f}%{RST}")
        print(f"    ending balance  p5 ${ru['final_p5']:>9,.0f}   median ${ru['final_p50']:>9,.0f}   "
              f"p95 ${ru['final_p95']:>9,.0f}")

    sl = a.get("slippage") or []
    if sl:
        be = a["breakeven_slippage_pips"]
        print(f"\n  Execution cost — the edge is ${a['net']/a['trades']:,.2f} per trade")
        print(f"    {'slip':>5}{'cost/trade':>12}{'net':>12}{'expectancy':>13}")
        for row in sl:
            col = G if row["survives"] else R_
            print(f"    {row['pips']:>4}p{row['cost_per_trade']:>11,.2f}{col}{row['net']:>12,.0f}{RST}"
                  f"{row['expectancy_r']:>+12.3f}R")
        col = G if be >= 6 else Y if be >= 3 else R_
        print(f"    {col}breakeven at {be:.1f} pips of round-trip slippage{RST}"
              f"{DIM}  — below ~3 pips this does not survive live execution{RST}")

    wf = a.get("walk_forward") or {}
    if wf.get("folds"):
        print(f"\n  Walk-forward over trade selection — {len(wf['folds'])} folds, "
              f"chosen on past trades and scored on unseen ones")
        for f in wf["folds"]:
            print(f"    from {f['test_from']}  chose {DIM}{f['chose']:<22}{RST}"
                  f"OOS {f['oos_tuned_exp'] if f['oos_tuned_exp'] is not None else 0:+.3f}R "
                  f"on {f['oos_tuned_n']:>3}   vs all trades {f['oos_base_exp']:+.3f}R on {f['oos_base_n']:>3}")
        t, b = wf["oos_tuned"], wf["oos_baseline"]
        if t and b:
            print(f"    {'':4}{'':22}  {'selected':>12}{'everything':>14}")
            print(f"    {'':4}{'trades':<22}  {t['n']:>12}{b['n']:>14}")
            print(f"    {'':4}{'net':<22}  ${t['net']:>11,.0f}${b['net']:>13,.0f}")
            print(f"    {'':4}{'profit factor':<22}  {t['pf']:>12.2f}{b['pf']:>14.2f}")
            print(f"    {'':4}{'expectancy':<22}  {t['exp_r']:>+12.3f}{b['exp_r']:>+14.3f}")
            print(f"    {'':4}{'Sharpe':<22}  {t['sharpe']:>12.2f}{b['sharpe']:>14.2f}")

    print(f"\n\033[1m  ACCEPTANCE CRITERIA\033[0m")
    all_pass = True
    for name, c in verdict(a).items():
        if c["pass"] is None:
            mark, col = "?", Y
            all_pass = False
        elif c["pass"]:
            mark, col = "PASS", G
        else:
            mark, col = "FAIL", R_
            all_pass = False
        print(f"    {col}[{mark:^4}]{RST} {name}")
        print(f"           {c['detail']}")
        print(f"           {DIM}{c['note']}{RST}")
    return all_pass


def main() -> int:
    p = argparse.ArgumentParser(description="Statistical acceptance tests")
    p.add_argument("--file", "-f", default=None, help="trade CSV (default: newest backtest file)")
    p.add_argument("--balance", "-b", type=float, default=1000.0)
    p.add_argument("--risk", "-r", type=float, default=1.0, help="percent risked per trade")
    p.add_argument("--trials", "-t", type=int, default=1,
                   help="how many parameter combinations were searched, for the Sharpe haircut")
    a = p.parse_args()

    path = a.file
    if path is None:
        for n in ("swing_core_backtest_trades.csv", "swing_smc_backtest_trades.csv"):
            if os.path.exists(os.path.join(DATA_DIR, n)):
                path = n
                break
    if path is None:
        print("[!] No backtest CSV found. Run RUN_BACKTEST.bat first.")
        return 1
    
    full = path if os.path.isabs(path) else os.path.join(DATA_DIR, path)
    if not os.path.exists(full):
        print(f"[!] {path} does not exist.")
        return 1

    df = pd.read_csv(full)
    if "r_multiple" not in df.columns:
        print(f"[!] {path} has no r_multiple column — that is a scan export, not a backtest.")
        return 1

    ok = render(analyse(df, a.balance, a.risk, a.trials), os.path.basename(path))
    with open(os.path.join(DATA_DIR, "stats_report.json"), "w") as f:
        json.dump(analyse(df, a.balance, a.risk, a.trials), f, indent=2, default=str)
    print(f"\n  wrote stats_report.json\n")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
