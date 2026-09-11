"""
MyTradingView — Honest Performance Metrics
==========================================

The old dashboard reported Rakhi Core as "67.7% win rate" while the strategy
lost $13,574 over 440 trades. Nothing was wrong with that percentage. The
problem was that win rate was the headline, the net figure sat beside it
mislabelled as "pips", and the number that actually explains the loss was not
on the page at all:

    average win    +$11
    average loss  -$139
    payoff ratio    0.08

At a payoff ratio of 0.08 you need to win 92.6% of the time to break even.
The strategy won 68%. That is the whole story, and it is one line.

So this module leads with:

    net USD                what actually happened
    payoff ratio           average win against average loss
    break-even win rate    what the payoff ratio demands
    expectancy per trade   in dollars

Win rate is reported, but never alone, and never first.

A note on R
-----------
Expectancy in R is only meaningful when every trade risks the same amount. The
historical files used a fixed 0.10 lots regardless of stop distance, so risk
per trade ranged from $4 to $667 and mean R came out at +3.4 on a book that
lost $13,574 — a win on a $4 stop scored +42R while a loss on a $667 stop
scored -1.02R. `expectancy_r` is therefore published with an
`r_is_meaningful` flag, computed from the dispersion of risk across trades.
Once risk.py sizes positions off the stop distance, that flag turns true and
the number starts meaning something.
"""

from typing import Dict, List, Optional

import numpy as np
import pandas as pd

import config

WIN = "WIN"
BREAKEVEN = "BREAKEVEN"
LOSS = "LOSS"

# A result inside this fraction of the trade's own risk is a scratch.
BREAKEVEN_BAND_R = 0.25

# A win smaller than this is a scratch win — it kept you flat, it did not pay
# for a loss. Surfaced separately because a strategy made almost entirely of
# these is the one that looks good on win rate and loses money.
SCRATCH_WIN_R = 0.5

# Above this coefficient of variation in per-trade risk, R comparisons across
# trades are not like for like.
R_NORMALISED_CV_LIMIT = 0.35


def classify(pnl_usd: float, risk_usd_total: Optional[float] = None,
             exit_reason: str = "") -> str:
    """
    Three-state outcome, judged on the result relative to the trade's own risk.

    The exit reason is a hint, not the verdict. An earlier version short
    circuited on "CTC" in the reason string, which mislabelled 281 Rakhi Core
    exits averaging +3.1R as breakevens — the backtester's stepped trail moves
    the stop above entry, so a "CTC Breakeven Exit" can bank real money.
    """
    if risk_usd_total and risk_usd_total > 0:
        band = BREAKEVEN_BAND_R * risk_usd_total
    else:
        band = 0.01

    if pnl_usd > band:
        return WIN
    if pnl_usd < -band:
        return LOSS
    return BREAKEVEN


def to_r(pnl_usd: float, risk_usd_total: Optional[float]) -> Optional[float]:
    if not risk_usd_total or risk_usd_total <= 0:
        return None
    return pnl_usd / risk_usd_total


def _empty(strategy: str, label: str) -> Dict:
    return {
        "strategy": strategy, "strategy_label": label, "total_trades": 0,
        "wins": 0, "breakevens": 0, "losses": 0, "scratch_wins": 0,
        "win_rate": 0.0, "loss_rate": 0.0, "breakeven_rate": 0.0, "scratch_win_rate": 0.0,
        "net_usd": 0.0, "gross_profit": 0.0, "gross_loss": 0.0,
        "profit_factor": 0.0, "profit_factor_excluding_breakeven": 0.0,
        "payoff_ratio": 0.0, "breakeven_win_rate": 0.0, "win_rate_margin": 0.0,
        "expectancy_usd": 0.0, "expectancy_r": 0.0, "r_is_meaningful": False,
        "risk_cv": 0.0, "is_profitable": False,
        "avg_win_usd": 0.0, "avg_loss_usd": 0.0, "avg_breakeven_usd": 0.0,
        "largest_loss_usd": 0.0, "largest_win_usd": 0.0, "max_drawdown_usd": 0.0,
        "period_months": 0.0, "period_start": None, "period_end": None,
        "net_usd_per_month": 0.0, "trades_per_month": 0.0,
        "engine_fingerprint": config.strategy_fingerprint(),
        "data_fingerprints": [], "is_stale": False, "fingerprint_unknown": True,
        "verdict": "No trades in this dataset.",
        "empty": True,
    }


def summarize(trades: List[Dict], strategy: str = "", label: str = "") -> Dict:
    if not trades:
        return _empty(strategy, label)

    rows = []
    for t in trades:
        pnl = float(t.get("pnl_usd", t.get("total_pnl", 0.0)) or 0.0)
        risk_total = t.get("risk_usd_total")
        if risk_total in (None, 0):
            try:
                dist = abs(float(t["entry_price"]) - float(t["sl"]))
                lots = float(t.get("lots", config.DEFAULT_LOTS))
                risk_total = dist * 100.0 * lots
            except Exception:
                risk_total = None
        rows.append({
            "pnl": pnl,
            "risk": risk_total,
            "r": to_r(pnl, risk_total),
            "outcome": classify(pnl, risk_total, t.get("exit_reason", "")),
            "entry_time": t.get("entry_time"),
            "fp": t.get("strategy_fingerprint"),
        })

    df = pd.DataFrame(rows)
    n = len(df)

    wins = df[df.outcome == WIN]
    losses = df[df.outcome == LOSS]
    bes = df[df.outcome == BREAKEVEN]

    gross_profit = float(df[df.pnl > 0].pnl.sum())
    gross_loss = float(abs(df[df.pnl < 0].pnl.sum()))
    net = float(df.pnl.sum())

    pf = (gross_profit / gross_loss) if gross_loss > 1e-9 else (99.0 if gross_profit > 0 else 0.0)

    decided = df[df.outcome != BREAKEVEN]
    d_gp = float(decided[decided.pnl > 0].pnl.sum())
    d_gl = float(abs(decided[decided.pnl < 0].pnl.sum()))
    pf_decided = (d_gp / d_gl) if d_gl > 1e-9 else (99.0 if d_gp > 0 else 0.0)

    avg_win = float(wins.pnl.mean()) if len(wins) else 0.0
    avg_loss = float(losses.pnl.mean()) if len(losses) else 0.0

    # The headline. Average win measured against average loss.
    payoff = (avg_win / abs(avg_loss)) if avg_loss < -1e-9 else (99.0 if avg_win > 0 else 0.0)

    # With this payoff ratio, the win rate needed just to break even.
    be_win_rate = (1.0 / (1.0 + payoff) * 100.0) if payoff > 0 else 100.0
    win_rate = len(wins) / n * 100.0

    # Wins too small to pay for a loss.
    scratch = wins[wins.r.notna() & (wins.r < SCRATCH_WIN_R)] if len(wins) else wins

    # Is R comparable across these trades?
    risks = df.risk.dropna()
    risk_cv = float(risks.std() / risks.mean()) if len(risks) > 1 and risks.mean() > 0 else 0.0
    r_meaningful = bool(risk_cv <= R_NORMALISED_CV_LIMIT and len(risks) > 1)
    r_vals = df.r.dropna()
    expectancy_r = float(r_vals.mean()) if len(r_vals) else 0.0

    months, first, last = _span_months(df)

    equity = df.pnl.cumsum()
    max_dd = float((equity.cummax() - equity).max()) if len(equity) else 0.0

    running_fp = config.strategy_fingerprint()
    fps = sorted({f for f in df.fp.dropna().unique().tolist() if f})

    return {
        "strategy": strategy,
        "strategy_label": label,
        "total_trades": n,

        "wins": len(wins),
        "breakevens": len(bes),
        "losses": len(losses),
        "scratch_wins": len(scratch),
        "win_rate": round(win_rate, 2),
        "breakeven_rate": round(len(bes) / n * 100, 2),
        "loss_rate": round(len(losses) / n * 100, 2),
        "scratch_win_rate": round(len(scratch) / n * 100, 2),

        "net_usd": round(net, 2),
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "profit_factor": round(pf, 2),
        "profit_factor_excluding_breakeven": round(pf_decided, 2),

        "avg_win_usd": round(avg_win, 2),
        "avg_loss_usd": round(avg_loss, 2),
        "avg_breakeven_usd": round(float(bes.pnl.mean()), 2) if len(bes) else 0.0,
        "payoff_ratio": round(payoff, 3),
        "breakeven_win_rate": round(be_win_rate, 1),
        "win_rate_margin": round(win_rate - be_win_rate, 1),

        "expectancy_usd": round(net / n, 2),
        "expectancy_r": round(expectancy_r, 3),
        "r_is_meaningful": r_meaningful,
        "risk_cv": round(risk_cv, 2),
        "is_profitable": net > 0,

        "largest_loss_usd": round(float(df.pnl.min()), 2),
        "largest_win_usd": round(float(df.pnl.max()), 2),
        "max_drawdown_usd": round(max_dd, 2),

        "period_months": round(months, 2),
        "period_start": first,
        "period_end": last,
        "net_usd_per_month": round(net / months, 2) if months > 0 else 0.0,
        "trades_per_month": round(n / months, 1) if months > 0 else 0.0,

        "engine_fingerprint": running_fp,
        "data_fingerprints": fps,
        "is_stale": bool(fps) and running_fp not in fps,
        "fingerprint_unknown": not fps,

        "verdict": _verdict(net, win_rate, be_win_rate, payoff, avg_win, avg_loss),
        "units_note": ("USD on the lot size recorded with each trade. "
                       "1 pip = $0.10 of gold price movement."),
        "empty": False,
    }


def _verdict(net, win_rate, be_win_rate, payoff, avg_win, avg_loss) -> str:
    """One sentence a person can act on."""
    if net > 0:
        return (f"Net positive. Wins {win_rate:.0f}% of the time and needs {be_win_rate:.0f}% "
                f"to break even, a margin of {win_rate - be_win_rate:.0f} points.")
    if payoff <= 0:
        return "Net negative, with no winning trades to measure against."
    return (f"Net negative. Wins {win_rate:.0f}% of the time but needs {be_win_rate:.0f}% "
            f"to break even, because the average win of ${avg_win:,.0f} is only "
            f"{payoff:.2f}x the average loss of ${abs(avg_loss):,.0f}. "
            f"Win rate is not the problem — the payoff ratio is.")


def _span_months(df: pd.DataFrame):
    try:
        times = pd.to_datetime(df.entry_time.dropna())
        if len(times) < 2:
            return 1.0, None, None
        first, last = times.min(), times.max()
        return max((last - first).days / 30.44, 1e-6), str(first.date()), str(last.date())
    except Exception:
        return 1.0, None, None


def compare(summaries: Dict[str, Dict]) -> Dict:
    """Ranks on net USD. Never on win rate."""
    ranked = sorted([s for s in summaries.values() if not s.get("empty")],
                    key=lambda s: s["net_usd"], reverse=True)
    return {
        "ranked": [s["strategy"] for s in ranked],
        "best": ranked[0]["strategy"] if ranked else None,
        "any_profitable": any(s["is_profitable"] for s in ranked),
        "warning": None if any(s["is_profitable"] for s in ranked)
        else "No strategy in this dataset is net profitable.",
    }
