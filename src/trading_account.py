"""
trading_account.py - one account, and only one.
===============================================
The robot is locked to a single account number. Every time it is about to do
anything that moves money it re-checks, because the terminal can be logged
into a different account by hand at any moment and the robot has no way to
notice unless it looks.

Credentials live in secrets.local.json, which is git-ignored. They are never
written to a source file and never returned by any API endpoint.
"""

from __future__ import annotations
import json
import os
import threading
from dataclasses import dataclass
from typing import Optional

try:
    import MetaTrader5 as mt5
    MT5_OK = True
except Exception:
    mt5 = None
    MT5_OK = False

_HERE = os.path.dirname(os.path.abspath(__file__))
SECRETS_PATH = os.path.join(os.path.dirname(_HERE), "secrets.local.json")

ACCOUNT_TRADE_MODE_DEMO = 0
ACCOUNT_TRADE_MODE_CONTEST = 1

_lock = threading.RLock()


@dataclass
class AccountStatus:
    ok: bool
    reason: str
    login: Optional[int] = None
    server: str = ""
    company: str = ""
    currency: str = ""
    equity: float = 0.0
    balance: float = 0.0
    is_demo: bool = False
    trade_allowed: bool = False
    algo_allowed: bool = False

    def as_dict(self):
        return dict(self.__dict__)


def load_config() -> dict:
    if not os.path.isfile(SECRETS_PATH):
        return {}
    try:
        with open(SECRETS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def expected_login() -> Optional[int]:
    c = load_config()
    try:
        return int(c.get("login")) if c.get("login") else None
    except Exception:
        return None


def connect() -> AccountStatus:
    """Log the terminal into the configured account. Idempotent."""
    if not MT5_OK:
        return AccountStatus(False, "The MetaTrader5 python package is not installed.")

    cfg = load_config()
    login, password, server = cfg.get("login"), cfg.get("password"), cfg.get("server")

    with _lock:
        if not mt5.initialize():
            if not mt5.initialize():
                return AccountStatus(False, "Could not attach to the MT5 terminal: %s" % (mt5.last_error(),))

        info = mt5.account_info()
        if info is not None:
            # If a specific login was configured in secrets.local.json, ensure it matches
            if login and int(info.login) != int(login):
                if not (password and server and mt5.login(int(login), password=str(password), server=str(server))):
                    return AccountStatus(False, "The terminal is on #%s, but configured for #%s." % (info.login, login))
            return verify()

        # Terminal not already logged into an account; credentials required
        if not (login and password and server):
            return AccountStatus(False, "secrets.local.json is missing login, password or server.")

        if not mt5.login(int(login), password=str(password), server=str(server)):
            return AccountStatus(False, "Login to %s on %s was refused: %s" % (login, server, mt5.last_error()))
        info = mt5.account_info()
        if info is None:
            return AccountStatus(False, "Logged in but the terminal returned no account info.")
        return verify()


def verify() -> AccountStatus:
    """The gate. Called before every order, not just at startup."""
    if not MT5_OK:
        return AccountStatus(False, "The MetaTrader5 python package is not installed.")
    cfg = load_config()
    want = cfg.get("login")
    allow_live = bool(cfg.get("allow_live_account", False))

    with _lock:
        term = mt5.terminal_info()
        info = mt5.account_info()
        if info is None:
            return AccountStatus(False, "MT5 is not reporting an account - is the terminal running?")

        is_demo = int(getattr(info, "trade_mode", 2)) in (ACCOUNT_TRADE_MODE_DEMO, ACCOUNT_TRADE_MODE_CONTEST)
        st = AccountStatus(
            ok=True, reason="", login=int(info.login), server=str(info.server),
            company=str(info.company), currency=str(info.currency),
            equity=float(info.equity), balance=float(info.balance),
            is_demo=is_demo, trade_allowed=bool(info.trade_allowed),
            algo_allowed=bool(term.trade_allowed) if term else False,
        )

        if want and int(info.login) != int(want):
            st.ok = False
            st.reason = ("WRONG ACCOUNT. The terminal is on #%s but this robot is locked to #%s. "
                         "It will not trade." % (info.login, want))
            return st
        if not is_demo and not allow_live:
            st.ok = False
            st.reason = ("#%s is a LIVE account. This robot is configured for demo only and "
                         "refuses to trade real money." % info.login)
            return st
        if not st.trade_allowed:
            st.ok = False
            st.reason = "The broker is not allowing trading on this account right now."
            return st
        if not st.algo_allowed:
            st.ok = False
            st.reason = "Algo Trading is switched off in MetaTrader. Click the Algo Trading button until it is green."
            return st
        return st
