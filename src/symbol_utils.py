"""
Broker Symbol Resolution Utilities
==================================
Handles suffix variations across different broker accounts (e.g. Standard 'm',
Cent 'c', Raw spread 'raw', '.m', '_i', 'k', etc.) dynamically and thread-safely.
"""
from __future__ import annotations
import threading
from typing import Optional

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False


def clean_base_symbol(symbol: str) -> str:
    """Strip common broker suffixes to extract the pure asset ticker."""
    if not symbol:
        return ""
    s = str(symbol).strip()
    for suffix in [".m", ".c", "_i", "m.raw", "c.raw", "pro", "raw", "c", "m", "k"]:
        if s.lower().endswith(suffix):
            return s[:-len(suffix)]
    return s


def resolve_broker_symbol(symbol: str, mt5_lock: Optional[threading.RLock] = None) -> str:
    """
    Find the exact matching symbol in MT5, handling broker suffix variations
    (e.g., XAUUSD vs XAUUSDc vs XAUUSDm vs BTCUSD vs BTCUSDc vs BTCUSDm).
    """
    if not MT5_AVAILABLE or not symbol:
        return symbol

    # Use supplied lock if given
    lock_context = mt5_lock if mt5_lock is not None else threading.Lock()
    with lock_context:
        try:
            # 1. Exact match
            info = mt5.symbol_info(symbol)
            if info is not None:
                if not info.visible:
                    mt5.symbol_select(symbol, True)
                return symbol

            # 2. Try clean base symbol and common broker suffixes
            base = clean_base_symbol(symbol)
            candidates = [
                base,
                base + "m",
                base + "c",
                base + ".m",
                base + ".c",
                base + "_i",
                base + "k",
                base + "m.raw",
                base + "c.raw",
                base + "pro",
                base + "raw",
            ]
            for cand in candidates:
                info = mt5.symbol_info(cand)
                if info is not None:
                    if not info.visible:
                        mt5.symbol_select(cand, True)
                    return cand

            # 3. Search all available broker symbols for a match
            all_syms = mt5.symbols_get()
            if all_syms:
                base_upper = base.upper()
                # Try exact base match
                for s in all_syms:
                    s_up = s.name.upper()
                    if clean_base_symbol(s_up) == base_upper:
                        if not s.visible:
                            mt5.symbol_select(s.name, True)
                        return s.name

                # Try prefix match
                for s in all_syms:
                    s_up = s.name.upper()
                    if s_up.startswith(base_upper):
                        if not s.visible:
                            mt5.symbol_select(s.name, True)
                        return s.name
        except Exception:
            pass

    return symbol
