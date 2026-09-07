"""
strategy_runtime.py — the live half of the MyBrains desk.
=========================================================
The research floor (MyBrains, in the browser) searches for a strategy and
expresses it as a set of GENOMES. This module is the only thing that turns
those genomes into a live trading decision.

It mirrors ONE function from myBrainsLab.js — `entryDir` — plus the bar
validity and session rules around it. Everything else about the backtest
stays in JavaScript. There is a parity test (tools/parity_check.py) that
runs both implementations over the same bars and asserts they agree on
every single entry. If you change the JavaScript, run it.

Nothing in this file talks to MetaTrader. It takes bars in and returns a
decision out, which makes it testable without a broker.
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

import strategy_structure as ss

# --------------------------------------------------------------------------
# The default pipeline, identical to DEFAULT_GENOMES in myBrainsLab.js.
# Used only until the research floor publishes something audited.
# --------------------------------------------------------------------------

DEFAULT_GENOMES: Dict[str, Dict[str, float]] = {
    "data": {"minRangeAtr": 0.12, "maxGapAtr": 3.0, "warmup": 60},
    "science": {"mode": 0, "fast": 21, "slow": 50, "rsiLen": 14, "rsiLong": 52,
                "rsiShort": 48, "trendLen": 200, "useTrend": 1, "breakLen": 20,
                "allowShort": 1, "pivotLen": 4, "levelTol": 0.35, "divLen": 20,
                "bandLen": 20, "bandK": 2.0,
                "tlTf": 2, "tlPlay": 0, "tlMinTaps": 3, "tlMinAge": 21, "tlMaxAngle": 45,
                "obTf": 1, "obImpulse": 1, "obMaxAge": 20, "obConfirm": 1},
    "math": {"atrLen": 14, "slAtr": 1.6, "rr": 1.8, "maxHold": 48},
    "political": {"hourMask": 0, "dayMask": 0},
    "legal": {"maxDailyLossR": 4, "cooldownBars": 0, "maxTradesDay": 6},
    "investment": {"usePartial": 0, "partialAtR": 1.0, "partialFrac": 0.5,
                   "useTrail": 0, "trailAtR": 1.2, "trailAtr": 2.0},
    "finance": {"riskPct": 1.0, "ddThrottle": 0, "throttleAtDD": 10, "compound": 1},
    "cost": {"costMult": 1.3, "slipAtr": 0.04, "minEdgeMult": 3.0},
    "regime": {"mode": 0, "len": 60, "thresh": 0.25, "volLo": 0.5, "volHi": 2.2},
}

# The disciplines the research floor may explore but this trader cannot
# execute. Kept in one place so the app, the audit and the trader all agree.
RESEARCH_ONLY_MODES = ()


def can_execute(cfg) -> tuple:
    """Can the live trader actually run this strategy? Returns (ok, reason)."""
    try:
        mode = int(cfg["science"]["mode"])
    except Exception:
        return False, "the strategy has no analyst discipline set"
    if mode in RESEARCH_ONLY_MODES:
        name = {7: "top-down trend line", 8: "order block"}.get(mode, "mode %d" % mode)
        return False, (
            f"this strategy uses the {name} analyst, which the live trader "
            "cannot reproduce bar for bar yet - it is research only")
    if mode < 0 or mode > 8:
        return False, "unknown analyst discipline (%d)" % mode
    return True, "ok"


# --------------------------------------------------------------------------
# Indicators — deliberately written the same way as the JavaScript, including
# the seeding, because a different seed produces a different first hundred
# bars and therefore a different strategy.
# --------------------------------------------------------------------------

def ema(close: Sequence[float], period: int) -> List[float]:
    n = len(close)
    out = [0.0] * n
    k = 2.0 / (period + 1.0)
    e = close[0] if n else 0.0
    for i in range(n):
        e = close[i] * k + e * (1.0 - k)
        out[i] = e
    return out


def atr(high: Sequence[float], low: Sequence[float], close: Sequence[float], period: int) -> List[float]:
    n = len(close)
    out = [0.0] * n
    k = 1.0 / period
    a = (high[0] - low[0]) if n else 0.0
    for i in range(n):
        pc = close[i - 1] if i else close[0]
        tr = max(high[i] - low[i], abs(high[i] - pc), abs(low[i] - pc))
        a = tr if i == 0 else a + (tr - a) * k
        out[i] = a if a else 1e-9
    return out


def rsi(close: Sequence[float], period: int) -> List[float]:
    n = len(close)
    out = [0.0] * n
    k = 1.0 / period
    g = 0.0
    ls = 0.0
    for i in range(1, n):
        d = close[i] - close[i - 1]
        up = d if d > 0 else 0.0
        dn = -d if d < 0 else 0.0
        g = up if i == 1 else g + (up - g) * k
        ls = dn if i == 1 else ls + (dn - ls) * k
        out[i] = 100.0 if ls == 0 else 100.0 - 100.0 / (1.0 + g / ls)
    if n:
        out[0] = 50.0
    return out


def sma(close: Sequence[float], period: int) -> List[float]:
    n = len(close)
    out = [0.0] * n
    total = 0.0
    for i in range(n):
        total += close[i]
        if i >= period:
            total -= close[i - period]
        out[i] = total / min(i + 1, period)
    return out


def stdev(close: Sequence[float], period: int) -> List[float]:
    n = len(close)
    out = [0.0] * n
    total = 0.0
    sq = 0.0
    for i in range(n):
        total += close[i]
        sq += close[i] * close[i]
        if i >= period:
            total -= close[i - period]
            sq -= close[i - period] * close[i - period]
        k = min(i + 1, period)
        out[i] = math.sqrt(max(0.0, sq / k - (total / k) ** 2))
    return out


def pivots(high: Sequence[float], low: Sequence[float], w: int):
    """Swing highs and lows — the raw material for trend lines and levels."""
    n = len(high)
    hi = [0] * n
    lo = [0] * n
    for i in range(w, n - w):
        is_h = True
        is_l = True
        for j in range(i - w, i + w + 1):
            if j == i:
                continue
            if high[j] >= high[i]:
                is_h = False
            if low[j] <= low[i]:
                is_l = False
            if not is_h and not is_l:
                break
        hi[i] = 1 if is_h else 0
        lo[i] = 1 if is_l else 0
    return hi, lo


def rolling_max(high: Sequence[float], period: int) -> List[float]:
    n = len(high)
    out = [0.0] * n
    for i in range(n):
        out[i] = max(high[max(0, i - period + 1): i + 1])
    return out


def rolling_min(low: Sequence[float], period: int) -> List[float]:
    n = len(low)
    out = [0.0] * n
    for i in range(n):
        out[i] = min(low[max(0, i - period + 1): i + 1])
    return out


# --------------------------------------------------------------------------
# Bars
# --------------------------------------------------------------------------

DEFAULT_SPREAD = 0.26          # gold on this account, from config.py


@dataclass
class Bars:
    spread: float = 0.26
    t: List[int] = field(default_factory=list)            # epoch ms
    o: List[float] = field(default_factory=list)
    h: List[float] = field(default_factory=list)
    l: List[float] = field(default_factory=list)
    c: List[float] = field(default_factory=list)
    hour: List[int] = field(default_factory=list)   # UTC
    day: List[int] = field(default_factory=list)    # UTC, 0 = Sunday

    def __post_init__(self):
        if not self.hour:
            import datetime as _dt
            self.hour = []
            self.day = []
            for ms in self.t:
                d = _dt.datetime.utcfromtimestamp(ms / 1000.0)
                self.hour.append(d.hour)
                # Python: Monday=0..Sunday=6. JavaScript getUTCDay: Sunday=0..Saturday=6.
                self.day.append((d.weekday() + 1) % 7)

    def __len__(self):
        return len(self.c)


class Indicators:
    """Computed once per bar batch, reused for every decision on that batch."""

    def __init__(self, bars: Bars, cfg: Dict[str, Dict[str, float]]):
        S, M = cfg["science"], cfg["math"]
        self.atr = atr(bars.h, bars.l, bars.c, int(M["atrLen"]))
        self.emaF = ema(bars.c, int(S["fast"]))
        self.emaS = ema(bars.c, int(S["slow"]))
        self.rsi = rsi(bars.c, int(S["rsiLen"]))
        self.trend = ema(bars.c, int(S["trendLen"])) if S["useTrend"] else None
        mode = int(S["mode"])
        self.hh = rolling_max(bars.h, int(S["breakLen"])) if mode == 2 else None
        self.ll = rolling_min(bars.l, int(S["breakLen"])) if mode == 2 else None
        # the specialist analysts need their own tools
        self.piv_hi = self.piv_lo = None
        if mode in (3, 4):
            self.piv_hi, self.piv_lo = pivots(bars.h, bars.l, int(S.get("pivotLen", 4)))
        self.band_m = self.band_sd = None
        if mode == 6:
            bl = int(S.get("bandLen", 20))
            self.band_m = sma(bars.c, bl)
            self.band_sd = stdev(bars.c, bl)
        # Market Regime needs its own lookback EMA and a volatility ratio
        R = cfg.get("regime") or {}
        self.regime_ema = ema(bars.c, int(R["len"])) if R.get("mode") else None
        self.vol_ratio = None
        if R.get("mode"):
            k = 2.0 / 201.0
            e = self.atr[0] if self.atr else 0.0
            vr = []
            for a in self.atr:
                e = a * k + e * (1.0 - k)
                vr.append(a / e if e > 0 else 1.0)
            self.vol_ratio = vr


# --------------------------------------------------------------------------
# The three rules the live trader mirrors from the research engine
# --------------------------------------------------------------------------

def bar_usable(bars: Bars, cfg, i: int, ind: Indicators) -> bool:
    """Data Analysts: is this bar worth believing?"""
    D = cfg["data"]
    if i < 1:
        return False
    a = ind.atr[i]
    if not (a > 0):
        return False
    if (bars.h[i] - bars.l[i]) < D["minRangeAtr"] * a:
        return False
    if abs(bars.o[i] - bars.c[i - 1]) > D["maxGapAtr"] * a:
        return False
    return True


def entry_dir(bars: Bars, cfg, i: int, ind: Indicators) -> int:
    """Data Scientists: is there a thesis on this bar? Returns 1, -1 or 0.

    Mirror of entryDir() in myBrainsLab.js. Do not edit one without the other.
    """
    S = cfg["science"]
    if int(S["mode"]) in RESEARCH_ONLY_MODES:
        return 0
    c = bars.c
    if i < 1:
        return 0
    r = ind.rsi[i]
    mode = int(S["mode"])
    d = 0

    # ---- the specialist disciplines, mirroring entryDir() in myBrainsLab.js ----
    if mode >= 3:
        a = ind.atr[i]
        if not (a > 0):
            return 0
        if mode == 3:
            # Trend-line break: the line through the last two swing highs
            hs, ls = [], []
            j = i - 1
            floor_j = max(1, i - 160)
            while j >= floor_j and (len(hs) < 2 or len(ls) < 2):
                if ind.piv_hi[j] and len(hs) < 2:
                    hs.append(j)
                if ind.piv_lo[j] and len(ls) < 2:
                    ls.append(j)
                j -= 1
            if len(hs) == 2:
                b2, b1 = hs[0], hs[1]
                slope = (bars.h[b2] - bars.h[b1]) / (b2 - b1)
                line = bars.h[b2] + slope * (i - b2)
                if slope < 0 and c[i] > line and c[i - 1] <= line + slope:
                    d = 1
            if not d and S["allowShort"] and len(ls) == 2:
                b2, b1 = ls[0], ls[1]
                slope = (bars.l[b2] - bars.l[b1]) / (b2 - b1)
                line = bars.l[b2] + slope * (i - b2)
                if slope > 0 and c[i] < line and c[i - 1] >= line + slope:
                    d = -1
        elif mode == 4:
            # Support and resistance: came to a level and turned away from it
            tol = S["levelTol"] * a
            sup = res = None
            for j in range(i - 2, max(0, i - 221), -1):
                if ind.piv_lo[j] and abs(bars.l[j] - c[i]) < tol and sup is None:
                    sup = bars.l[j]
                if ind.piv_hi[j] and abs(bars.h[j] - c[i]) < tol and res is None:
                    res = bars.h[j]
                if sup is not None and res is not None:
                    break
            if sup is not None and bars.l[i] <= sup + tol * 0.5 and c[i] > sup and c[i] > bars.o[i]:
                d = 1
            elif S["allowShort"] and res is not None and bars.h[i] >= res - tol * 0.5 and c[i] < res and c[i] < bars.o[i]:
                d = -1
        elif mode == 5:
            # Divergence: a new extreme that momentum does not confirm
            L = int(S["divLen"])
            if i < L + 2:
                return 0
            lo_idx = hi_idx = i - L
            for j in range(i - L, i):
                if bars.l[j] < bars.l[lo_idx]:
                    lo_idx = j
                if bars.h[j] > bars.h[hi_idx]:
                    hi_idx = j
            if bars.l[i] < bars.l[lo_idx] and ind.rsi[i] > ind.rsi[lo_idx] and r <= S["rsiShort"] + 18:
                d = 1
            elif S["allowShort"] and bars.h[i] > bars.h[hi_idx] and ind.rsi[i] < ind.rsi[hi_idx] and r >= S["rsiLong"] - 18:
                d = -1
        elif mode == 6:
            # Mean reversion: stretched from the mean and snapping back
            k = S["bandK"]
            up = ind.band_m[i] + k * ind.band_sd[i]
            dn = ind.band_m[i] - k * ind.band_sd[i]
            up_p = ind.band_m[i - 1] + k * ind.band_sd[i - 1]
            dn_p = ind.band_m[i - 1] - k * ind.band_sd[i - 1]
            if c[i - 1] < dn_p and c[i] > dn:
                d = 1
            elif S["allowShort"] and c[i - 1] > up_p and c[i] < up:
                d = -1
        elif mode == 7:
            # Top-down trend line. The line lives on a higher timeframe, has
            # never been closed through, and has to clear the A+ bar the floor
            # evolved. Signals are stamped on the base bar the higher-timeframe
            # candle CLOSED on, so nothing here sees inside an unfinished candle.
            tf = ss.TL_TFS[max(0, min(3, int(round(S["tlTf"]))))]
            prep = ss.struct_for(bars, "ray", tf, ss.TL_PIVOT[tf], key=getattr(bars, "key", ""))
            evs = prep["byBase"].get(i)
            if not evs:
                return 0
            want = "break" if int(round(S["tlPlay"])) else "bounce"
            for e in evs:
                if e["type"] != want:
                    continue
                if e["taps"] < S["tlMinTaps"]:
                    continue
                if e["ageDays"] < S["tlMinAge"]:
                    continue
                if e["angle"] > S["tlMaxAngle"]:
                    continue
                if e["dir"] < 0 and not S["allowShort"]:
                    continue
                d = e["dir"]
                break
        elif mode == 8:
            # Order block. The zone exists only if the move out of it closed
            # past the prior swing (structure) and left a gap between candle 1
            # and candle 3 (displacement). The first return is the only trade.
            tf = ss.OB_TFS[max(0, min(2, int(round(S["obTf"]))))]
            imp = ss.OB_IMPULSE[max(0, min(2, int(round(S["obImpulse"]))))]
            prep = ss.struct_for(bars, "ob", tf, 3, imp, key=getattr(bars, "key", ""))
            evs = prep["byBase"].get(i)
            if not evs:
                return 0
            need_close = bool(int(round(S["obConfirm"])))
            for e in evs:
                if e["ageDays"] > S["obMaxAge"]:
                    continue
                if need_close and not e["closedBack"]:
                    continue
                if e["dir"] < 0 and not S["allowShort"]:
                    continue
                d = e["dir"]
                break
        if not d:
            return 0
        if S["useTrend"]:
            if d > 0 and c[i] < ind.trend[i]:
                return 0
            if d < 0 and c[i] > ind.trend[i]:
                return 0
        return d

    if mode == 0:
        if ind.emaF[i] > ind.emaS[i] and ind.emaF[i - 1] <= ind.emaS[i - 1] and r >= S["rsiLong"]:
            d = 1
        elif S["allowShort"] and ind.emaF[i] < ind.emaS[i] and ind.emaF[i - 1] >= ind.emaS[i - 1] and r <= S["rsiShort"]:
            d = -1
    elif mode == 1:
        if ind.emaF[i] > ind.emaS[i] and c[i] < ind.emaF[i] and c[i - 1] >= ind.emaF[i - 1] and r >= S["rsiLong"] - 12:
            d = 1
        elif S["allowShort"] and ind.emaF[i] < ind.emaS[i] and c[i] > ind.emaF[i] and c[i - 1] <= ind.emaF[i - 1] and r <= S["rsiShort"] + 12:
            d = -1
    else:
        if c[i] > ind.hh[i - 1] and r >= S["rsiLong"]:
            d = 1
        elif S["allowShort"] and c[i] < ind.ll[i - 1] and r <= S["rsiShort"]:
            d = -1
    if not d:
        return 0
    if S["useTrend"]:
        if d > 0 and c[i] < ind.trend[i]:
            return 0
        if d < 0 and c[i] > ind.trend[i]:
            return 0
    return d


def regime_ok(bars: Bars, cfg, i: int, ind: Indicators) -> bool:
    """Market Regime: is this the kind of market this strategy is for?

    Mirror of regimeOk() in myBrainsLab.js.
    """
    R = cfg.get("regime")
    if not R or not int(R["mode"]):
        return True
    ln = int(R["len"])
    if i < ln + 1:
        return False
    a = ind.atr[i]
    if not (a > 0):
        return False
    e = ind.regime_ema
    strength = abs(e[i] - e[i - ln]) / (a * math.sqrt(ln))
    trending = strength >= R["thresh"]
    if int(R["mode"]) == 1 and not trending:
        return False
    if int(R["mode"]) == 2 and trending:
        return False
    vr = ind.vol_ratio[i]
    if vr < R["volLo"] or vr > R["volHi"]:
        return False
    return True


def trade_cost(bars: Bars, cfg, i: int, ind: Indicators) -> float:
    """Cost & Capacity: what a round trip really costs, in price units."""
    C = cfg.get("cost") or {"costMult": 1.0, "slipAtr": 0.0}
    spread = bars.spread if bars.spread else DEFAULT_SPREAD
    return spread * C["costMult"] + 2 * C["slipAtr"] * ind.atr[i]


def session_allowed(bars: Bars, cfg, i: int) -> bool:
    """Political Analysts: is this an hour and a weekday they have not vetoed?"""
    P = cfg["political"]
    if (int(P["hourMask"]) >> (bars.hour[i] // 4)) & 1:
        return False
    if (int(P["dayMask"]) >> bars.day[i]) & 1:
        return False
    return True


def warmup_bars(cfg) -> int:
    S, D = cfg["science"], cfg["data"]
    need = [int(D["warmup"]), int(S["slow"]) + 5, 3]
    if S["useTrend"]:
        need.append(int(S["trendLen"]) + 2)
    mode = int(S["mode"])
    if mode == 2:
        need.append(int(S["breakLen"]) + 2)
    if mode == 3:
        need.append(170)
    if mode == 4:
        need.append(230)
    if mode == 5:
        need.append(int(S.get("divLen", 20)) + 4)
    if mode == 6:
        need.append(int(S.get("bandLen", 20)) + 4)
    if mode == 7:
        # a Monthly line needs months of base bars before it exists at all
        need.append(400)
    if mode == 8:
        need.append(300)
    return max(need)


# --------------------------------------------------------------------------
# Turning a thesis into an order
# --------------------------------------------------------------------------

@dataclass
class Decision:
    action: str                   # "enter" | "wait"
    direction: int = 0            # 1 long, -1 short
    reason: str = ""
    stop_distance: float = 0.0    # price units
    rr: float = 0.0
    atr: float = 0.0
    bar_time: int = 0


def decide(bars: Bars, cfg, ind: Optional[Indicators] = None, i: Optional[int] = None) -> Decision:
    """Evaluate the LAST CLOSED bar and say whether to open a position.

    The caller is responsible for: is the market open, is a position already
    on, has the daily loss stop been hit, is this account the right account.
    Those are not this function's job and keeping them out of it is what
    makes this function testable.
    """
    if ind is None:
        ind = Indicators(bars, cfg)
    if i is None:
        i = len(bars) - 1
    if i < warmup_bars(cfg):
        return Decision("wait", reason="not enough history yet")
    if not bar_usable(bars, cfg, i, ind):
        return Decision("wait", reason="Data Analysts rejected this bar")
    d = entry_dir(bars, cfg, i, ind)
    if not d:
        return Decision("wait", reason="no setup")
    if not session_allowed(bars, cfg, i):
        return Decision("wait", reason="Political Analysts have vetoed this session")
    a = ind.atr[i]
    return Decision(
        action="enter", direction=d, reason="setup confirmed",
        stop_distance=cfg["math"]["slAtr"] * a, rr=cfg["math"]["rr"],
        atr=a, bar_time=bars.t[i],
    )


def position_size(equity: float, risk_pct: float, stop_distance: float,
                  tick_value: float, tick_size: float,
                  vol_min: float, vol_max: float, vol_step: float,
                  hard_cap: float = 1.0) -> float:
    """Lots such that a stop-out costs `risk_pct` of equity, and no more.

    Rounds DOWN to the broker's volume step. Rounding up would mean risking
    more than the mandate on every single trade, which is how a 1% risk model
    quietly becomes a 1.4% risk model.
    """
    if stop_distance <= 0 or tick_size <= 0 or tick_value <= 0 or equity <= 0:
        return 0.0
    risk_cash = equity * (risk_pct / 100.0)
    loss_per_lot = (stop_distance / tick_size) * tick_value
    if loss_per_lot <= 0:
        return 0.0
    lots = risk_cash / loss_per_lot
    lots = math.floor(lots / vol_step) * vol_step
    lots = min(lots, vol_max, hard_cap)
    if lots < vol_min:
        return 0.0
    return round(lots, 4)
