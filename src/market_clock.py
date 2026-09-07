"""
market_clock.py - when the business is open.
============================================
Forex closes for the weekend, so the desk sleeps on Saturday and Sunday.

Two extra rules that are not decoration:
  * no NEW positions after Friday 20:00 UTC
  * everything FLAT by Friday 20:45 UTC
Holding a leveraged position through the weekend means the market can reopen
tens of dollars away with no chance to stop out in between. A backtest never
shows you that, because a backtest fills your stop at your stop.
"""

from __future__ import annotations
import datetime as dt
from dataclasses import dataclass
from typing import Optional

# All times UTC. The broker's server clock drifts from UTC by a couple of
# hours depending on their DST rules; the guards below are wide enough that
# it does not matter, and the live quote-freshness check catches the rest.
SLEEP_WEEKDAYS = {5, 6}          # Python: Monday=0 .. Saturday=5, Sunday=6
FRIDAY = 4
FRIDAY_NO_NEW_UTC = 20.0
FRIDAY_FLAT_UTC = 20.75
MAX_QUOTE_AGE_SEC = 900


@dataclass
class MarketState:
    open: bool
    allow_new: bool
    force_flat: bool
    state: str
    reason: str
    next_open_utc: Optional[str] = None
    seconds_to_open: Optional[int] = None


def _next_monday(now: dt.datetime) -> dt.datetime:
    days = (7 - now.weekday()) % 7 or 7
    return (now + dt.timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)


def market_state(now: Optional[dt.datetime] = None,
                 quote_age_sec: Optional[float] = None,
                 symbol_tradable: bool = True) -> MarketState:
    now = now or dt.datetime.utcnow()
    hour = now.hour + now.minute / 60.0
    wd = now.weekday()

    if wd in SLEEP_WEEKDAYS:
        nxt = _next_monday(now)
        return MarketState(
            False, False, False, "weekend",
            "Weekend - the forex market is closed and the desk is asleep.",
            nxt.isoformat() + "Z", int((nxt - now).total_seconds()))

    if wd == FRIDAY and hour >= FRIDAY_FLAT_UTC:
        nxt = _next_monday(now)
        return MarketState(
            False, False, True, "friday-flat",
            "Friday close - positions are being flattened so nothing is carried over the weekend gap.",
            nxt.isoformat() + "Z", int((nxt - now).total_seconds()))

    if wd == FRIDAY and hour >= FRIDAY_NO_NEW_UTC:
        return MarketState(
            True, False, False, "friday-winddown",
            "Friday wind-down - managing open trades, taking no new ones into the weekend.")

    if not symbol_tradable:
        return MarketState(False, False, False, "symbol-closed",
                           "The broker has this symbol closed for trading right now.")

    if quote_age_sec is not None and quote_age_sec > MAX_QUOTE_AGE_SEC:
        return MarketState(False, False, False, "stale-quotes",
                           "No fresh quote for %d minutes - treating the market as closed." % int(quote_age_sec / 60))

    return MarketState(True, True, False, "open", "Market open.")
