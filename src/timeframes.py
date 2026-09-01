"""
Timeframe resolution and range fetching.

MetaTrader defines TIMEFRAME_M3 on every build, but a *broker* only serves bars
for the periods its server actually aggregates. Requesting a period the server
does not build returns an empty array — indistinguishable from "no history".
That is how a year-long backtest aborts with 15M, 1H and 1D all present and
only the 3M pull empty.

Every timeframe request goes through resolve() so a period the broker does not
serve downgrades to the next-finest one that works, instead of killing the run.
The downgrade is never silent: the effective name comes back to the caller and
is surfaced in the console banner, /api/health and the chart payload.

This module deliberately takes a caller-supplied `probe` function rather than
calling MetaTrader5 itself, because the web app serialises every MT5 call behind
a lock and the backtester does not.
"""

from __future__ import annotations

import time
from typing import Callable, List, Optional, Sequence, Tuple

try:
    import MetaTrader5 as mt5
except Exception:                                    # pragma: no cover
    mt5 = None


# Ordered preferences. The first entry the broker actually serves wins.
# 3M falls to 5M because that is the playbook's documented alternate entry
# timeframe (config.TIMEFRAME_LTF_FALLBACK), not merely the nearest number.
CHAIN = {
    "1M":  ["1M", "3M", "5M"],
    "3M":  ["3M", "5M", "1M"],
    "5M":  ["5M", "3M", "15M"],
    "15M": ["15M", "5M", "30M"],
    "30M": ["30M", "15M", "1H"],
    "1H":  ["1H", "30M", "15M"],
    "4H":  ["4H", "1H"],
    "1D":  ["1D", "4H", "1H"],
}

# Bars in one 24h day — used to size history requests once the effective
# timeframe is known, so a 3M→5M downgrade does not silently over-fetch.
BARS_PER_DAY = {"1M": 1440, "3M": 480, "5M": 288, "15M": 96,
                "30M": 48, "1H": 24, "4H": 6, "1D": 1}

MINUTES = {"1M": 1, "3M": 3, "5M": 5, "15M": 15,
           "30M": 30, "1H": 60, "4H": 240, "1D": 1440}

PROBE_TTL_SEC = 900


def const(name: str):
    """The MetaTrader constant for a timeframe name, or None if this build
    does not define it at all."""
    if mt5 is None:
        return None
    return {
        "1M":  getattr(mt5, "TIMEFRAME_M1", None),
        "3M":  getattr(mt5, "TIMEFRAME_M3", None),
        "5M":  getattr(mt5, "TIMEFRAME_M5", None),
        "15M": getattr(mt5, "TIMEFRAME_M15", None),
        "30M": getattr(mt5, "TIMEFRAME_M30", None),
        "1H":  getattr(mt5, "TIMEFRAME_H1", None),
        "4H":  getattr(mt5, "TIMEFRAME_H4", None),
        "1D":  getattr(mt5, "TIMEFRAME_D1", None),
    }.get(str(name).upper())


_CACHE: dict = {}          # (scope, requested) -> (effective_name, const, at)


def clear_cache(scope: str = "") -> None:
    """Forget probe results. Called when the symbol or terminal changes."""
    if not scope:
        _CACHE.clear()
        return
    for k in [k for k in _CACHE if k[0] == scope]:
        _CACHE.pop(k, None)


def resolve(name: str,
            probe: Callable[[object], Optional[Sequence]],
            scope: str = "") -> Tuple[str, object]:
    """
    Return (effective_name, mt5_const) for a requested timeframe.

    `probe(const)` must return a non-empty sequence of bars if the broker
    serves that period, and None/empty otherwise. It is called at most once
    per timeframe per PROBE_TTL_SEC, so this is cheap on the hot path.

    If nothing in the chain probes clean — terminal offline, symbol wrong —
    the requested constant is returned unchanged so the caller's own error
    handling reports the real problem rather than a bogus downgrade.
    """
    key = (scope, str(name).upper())
    hit = _CACHE.get(key)
    if hit and (time.time() - hit[2]) < PROBE_TTL_SEC:
        return hit[0], hit[1]

    requested = str(name).upper()
    fallback = const(requested)

    for candidate in CHAIN.get(requested, [requested]):
        c = const(candidate)
        if c is None:
            continue
        try:
            bars = probe(c)
        except Exception:
            bars = None
        if bars is not None and len(bars) > 0:
            _CACHE[key] = (candidate, c, time.time())
            return candidate, c

    return requested, fallback


def range_bars(symbol: str, tf_const, frm, to, chunk_days: int = 45):
    """
    Pull copy_rates_range in slices, newest first, and stitch the result.

    One 365-day call for a 3-minute period asks for ~175,000 bars. Terminals
    cap that ("Max bars in chart"), and some brokers refuse the call outright
    and return nothing — which reads as "no history" even though nine months
    of it are sitting on the server. Walking backwards in slices gets whatever
    the account genuinely has and stops at the first empty slice, so a partial
    year is still a usable backtest instead of an aborted one.
    """
    if mt5 is None or tf_const is None:
        return None

    import pandas as pd
    from datetime import timedelta

    frames: List = []
    cursor = to
    empty_streak = 0

    while cursor > frm:
        start = max(frm, cursor - timedelta(days=chunk_days))
        try:
            r = mt5.copy_rates_range(symbol, tf_const, start, cursor)
        except Exception:
            r = None
        if r is None or len(r) == 0:
            empty_streak += 1
            # Two consecutive empty slices means we have run past the end of
            # what the broker keeps. One can just be a holiday-shaped gap.
            if empty_streak >= 2:
                break
        else:
            empty_streak = 0
            frames.append(pd.DataFrame(r))
        cursor = start

    if not frames:
        return None

    d = pd.concat(frames, ignore_index=True)
    d = d.drop_duplicates(subset="time").sort_values("time").reset_index(drop=True)
    return d
