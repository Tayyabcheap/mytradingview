"""
Signal accuracy scorer.
For each generated signal, walk forward bar-by-bar and decide whether price reached
TP1 before SL (a win) or SL before TP1 (a loss). Ties within one bar resolve to SL
(conservative). Produces an honest scorecard: hit rate, expectancy in R, break-even
win rate, total R. Gross of costs — spread/commission/slippage are NOT included, so
real results are worse; treat this as an upper bound, not a promise.
"""
from typing import List, Dict, Any


def score_signals(highs: List[float], lows: List[float], signals: List[Dict[str, Any]],
                  max_hold: int = 300) -> Dict[str, Any]:
    n = len(highs)
    results = []  # +rr for a TP1 win, -1 for an SL loss
    wins = losses = opens = 0
    for s in signals:
        i = int(s["index"])
        typ = s["type"]
        sl = float(s["sl"])
        tp1 = float(s["tp1"])
        rr = float(s.get("tp1_rr") or 1.5)
        outcome = None
        end = min(i + max_hold, n)
        for j in range(i + 1, end):
            hi = highs[j]
            lo = lows[j]
            if typ == "BUY":
                if lo <= sl:
                    outcome = "SL"; break
                if hi >= tp1:
                    outcome = "TP1"; break
            else:  # SELL
                if hi >= sl:
                    outcome = "SL"; break
                if lo <= tp1:
                    outcome = "TP1"; break
        if outcome == "TP1":
            wins += 1; results.append(rr)
        elif outcome == "SL":
            losses += 1; results.append(-1.0)
        else:
            opens += 1

    closed = wins + losses
    win_rate = round(wins / closed * 100, 1) if closed else 0.0
    expectancy_R = round(sum(results) / closed, 3) if closed else 0.0
    avg_win_R = round(sum(r for r in results if r > 0) / wins, 2) if wins else 0.0
    be_wr = round(1 / (1 + avg_win_R) * 100, 1) if avg_win_R > 0 else 0.0
    total_R = round(sum(results), 2)

    verdict = "POSITIVE EDGE (gross)" if expectancy_R > 0 and closed >= 30 else \
              ("NEGATIVE / NO EDGE" if closed >= 30 else "NOT ENOUGH SIGNALS TO JUDGE")

    return {
        "signals": len(signals),
        "resolved": closed,
        "wins": wins,
        "losses": losses,
        "unresolved": opens,
        "win_rate": win_rate,
        "break_even_win_rate": be_wr,
        "expectancy_R": expectancy_R,
        "avg_win_R": avg_win_R,
        "total_R": total_R,
        "max_hold_bars": max_hold,
        "verdict": verdict,
        "note": "Gross of spread/commission/slippage; TP1-vs-SL, stop-first on ties.",
    }
