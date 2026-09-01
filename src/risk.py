"""
MyFinanceAdvisor — Position Sizing & Session Discipline
========================================================

Implements playbook §4, which the previous version declared in config and then
never referenced anywhere:

    "Account Sizing & Lots: 0.01 lot per $100-$200 balance
                            0.05 lot per $500-$1,000 balance
                            0.10-0.20 lot per $5,000+ balance"
    "Risk_Per_Trade_Percent = 1.0%"
    "Session Discipline: Max 2-4 trades per live session. If 2 consecutive
     setups hit SL or CTC during choppy range-bound days, trading is paused
     immediately."

`MAX_RISK_PERCENT = 1.0` existed in the old config and was read by nothing; the
execute endpoint took whatever lot number was typed into the box.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import config

# XAUUSD contract: 1.00 lot = 100 ounces, so a $1.00 price move is worth
# $100 per lot. This is the only place that number appears.
USD_PER_PRICE_UNIT_PER_LOT = 100.0

# Smallest volume the broker will accept.
BROKER_MIN_LOT = 0.01


# ===========================================================================
# Position sizing
# ===========================================================================

def lots_from_balance_tier(balance: float) -> float:
    """Playbook §4 sizing table. Highest tier whose threshold is met wins."""
    lot = config.LOT_SIZE_TIERS[0][1]
    for min_bal, size in config.LOT_SIZE_TIERS:
        if balance >= min_bal:
            lot = size
    return lot


def lots_from_risk(balance: float, risk_usd: float, risk_percent: Optional[float] = None) -> float:
    """
    Lot size such that a full stop-out costs exactly `risk_percent` of balance.

        risk_usd  distance from entry to stop, in USD of price movement
    """
    pct = config.MAX_RISK_PERCENT if risk_percent is None else risk_percent
    if risk_usd <= 0 or balance <= 0:
        return config.DEFAULT_LOTS
    budget = balance * (pct / 100.0)
    return budget / (risk_usd * USD_PER_PRICE_UNIT_PER_LOT)


def suggest_lots(balance: float, risk_usd: float, risk_percent: Optional[float] = None) -> Dict:
    """
    The size actually offered on the Trade Desk: the MORE CONSERVATIVE of the
    playbook's balance tier and its 1% risk rule, clamped to broker limits.

    Returns the working so the desk can show why, rather than presenting a
    number with no derivation.
    """
    pct = config.MAX_RISK_PERCENT if risk_percent is None else risk_percent
    tier = lots_from_balance_tier(balance)
    by_risk = lots_from_risk(balance, risk_usd, pct)

    raw = min(tier, by_risk)
    lots = max(BROKER_MIN_LOT, min(config.MAX_LOTS, round(raw + 1e-9, 2)))

    stop_cost = risk_usd * USD_PER_PRICE_UNIT_PER_LOT * lots
    actual_pct = (stop_cost / balance * 100.0) if balance > 0 else None

    # A small account cannot always honour the 1% rule: the broker's minimum
    # lot may already risk more than the budget allows. Say so plainly rather
    # than clamping and presenting a number that implies the rule was met.
    over_budget = bool(actual_pct is not None and actual_pct > pct + 0.01)
    warning = None
    if over_budget:
        min_balance = (risk_usd * USD_PER_PRICE_UNIT_PER_LOT * BROKER_MIN_LOT) / (pct / 100.0)
        warning = (
            f"Minimum lot ({BROKER_MIN_LOT}) risks ${stop_cost:.2f} = {actual_pct:.1f}% of a "
            f"${balance:,.0f} balance, above your {pct:.0f}% limit. A {pct:.0f}% risk on this "
            f"${risk_usd:.2f} stop needs about ${min_balance:,.0f}. Either skip the setup, "
            f"wait for a tighter stop, or accept the higher risk deliberately."
        )

    return {
        "lots": lots,
        "tier_lots": round(tier, 2),
        "risk_lots": round(by_risk, 3),
        "binding_constraint": (
            "broker minimum lot" if raw < BROKER_MIN_LOT else
            "broker maximum lot" if raw > config.MAX_LOTS else
            "1% risk rule" if by_risk < tier else "balance tier"
        ),
        "risk_usd_per_unit": round(risk_usd, 3),
        "risk_pips": round(config.to_pips(risk_usd), 1),
        "stop_out_cost_usd": round(stop_cost, 2),
        "stop_out_pct_of_balance": round(actual_pct, 2) if actual_pct is not None else None,
        "risk_percent_used": pct,
        "exceeds_risk_budget": over_budget,
        "warning": warning,
        "capped_by_broker_max": raw > config.MAX_LOTS,
    }


# ===========================================================================
# Session discipline
# ===========================================================================

@dataclass
class SessionState:
    session_key: str = ""
    trades_taken: int = 0
    consecutive_stops: int = 0
    paused_until: Optional[datetime] = None
    history: List[Dict] = field(default_factory=list)


class SessionGuard:
    """
    Enforces the per-session trade cap and the two-consecutive-stops circuit
    breaker. A CTC breakeven exit counts toward the breaker: the playbook says
    "if 2 consecutive setups hit SL *or CTC*", because two setups that both
    failed to run are the signature of a choppy day.
    """

    def __init__(self) -> None:
        self.state = SessionState()

    @staticmethod
    def _session_key(now: datetime) -> str:
        date_str = now.strftime("%Y-%m-%d")
        
        hour = now.hour
        if hour < 7:
            session = "ASIAN"
        elif hour < 12:
            session = "LONDON"
        elif hour < 16:
            session = "NY_OVERLAP"
        else:
            session = "NY_LATE"
            
        return f"{date_str}_{session}"

    def _roll(self, now: datetime) -> None:
        key = self._session_key(now)
        if key != self.state.session_key:
            self.state = SessionState(session_key=key)

    def can_trade(self, now: Optional[datetime] = None, open_positions: int = 0) -> Dict:
        now = now or datetime.now(timezone.utc)
        self._roll(now)
        s = self.state

        if s.paused_until and now < s.paused_until:
            mins = int((s.paused_until - now).total_seconds() // 60)
            return {
                "allowed": False,
                "reason": (f"Circuit breaker tripped — {config.CONSECUTIVE_STOPS_TO_PAUSE} "
                           f"consecutive stopped/breakeven exits. Trading paused for {mins} "
                           f"more minutes (playbook §4)."),
                "code": "PAUSED",
                "resumes_at": s.paused_until.isoformat(),
            }

        if open_positions >= config.MAX_OPEN_TRADES:
            return {
                "allowed": False,
                "reason": f"{open_positions} positions already open (max {config.MAX_OPEN_TRADES}).",
                "code": "MAX_OPEN",
            }

        if s.trades_taken >= config.MAX_TRADES_PER_SESSION:
            return {
                "allowed": False,
                "reason": (f"Session trade cap reached — {s.trades_taken} of "
                           f"{config.MAX_TRADES_PER_SESSION} taken (playbook §4)."),
                "code": "SESSION_CAP",
            }

        return {
            "allowed": True,
            "reason": (f"{s.trades_taken}/{config.MAX_TRADES_PER_SESSION} session trades used, "
                       f"{s.consecutive_stops}/{config.CONSECUTIVE_STOPS_TO_PAUSE} toward the pause."),
            "code": "OK",
        }

    def record_entry(self, now: Optional[datetime] = None, note: str = "") -> None:
        now = now or datetime.now(timezone.utc)
        self._roll(now)
        self.state.trades_taken += 1
        self.state.history.append({"at": now.isoformat(), "event": "ENTRY", "note": note})

    def record_exit(self, outcome: str, now: Optional[datetime] = None) -> Dict:
        """
        outcome: "WIN" | "BREAKEVEN" | "LOSS"

        A real win resets the breaker. A loss or a breakeven advances it.
        """
        now = now or datetime.now(timezone.utc)
        self._roll(now)
        s = self.state

        if outcome == "WIN":
            s.consecutive_stops = 0
        else:
            s.consecutive_stops += 1
            if s.consecutive_stops >= config.CONSECUTIVE_STOPS_TO_PAUSE:
                s.paused_until = now + timedelta(minutes=config.PAUSE_DURATION_MINUTES)

        s.history.append({"at": now.isoformat(), "event": "EXIT", "outcome": outcome})
        return {
            "consecutive_stops": s.consecutive_stops,
            "paused_until": s.paused_until.isoformat() if s.paused_until else None,
        }

    def snapshot(self) -> Dict:
        s = self.state
        return {
            "session": s.session_key,
            "trades_taken": s.trades_taken,
            "max_trades": config.MAX_TRADES_PER_SESSION,
            "consecutive_stops": s.consecutive_stops,
            "pause_threshold": config.CONSECUTIVE_STOPS_TO_PAUSE,
            "paused_until": s.paused_until.isoformat() if s.paused_until else None,
            "is_paused": bool(s.paused_until and datetime.now(timezone.utc) < s.paused_until),
        }

    def reset(self) -> None:
        self.state = SessionState()
