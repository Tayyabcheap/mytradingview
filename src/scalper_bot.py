"""
Autonomous MT5 Scalper Execution Daemon (Multi-Instrument Engine)
=================================================================
Server-side background engine that monitors 5M bars directly from MetaTrader 5
across up to 10 selected currency pairs / instruments simultaneously.

Evaluates closed bars using Haider-Scalper-Enhanced (and Haider-Gold-Scalper),
and autonomously executes 2-tranche scaling trades with dynamic Auto-Breakeven at TP1.

Operates 24/5 completely independent of the browser frontend.
"""

from __future__ import annotations
import time
import math
import logging
import threading
import datetime
from typing import Dict, Any, Optional, List

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False

from real_dip_bt import wilder_atr, wilder_rsi
from notifications import send_discord_alert
from symbol_utils import resolve_broker_symbol, clean_base_symbol
from neural_sentinel import neural_sentinel

try:
    import store as app_store
except ImportError:
    app_store = None

logger = logging.getLogger("scalper_bot")
logger.setLevel(logging.INFO)

MAX_INSTRUMENTS = 10
DEFAULT_SYMBOLS = ["XAUUSDm", "BTCUSDm", "GBPUSDm", "GBPJPYm", "USDJPYm"]

CHAMPION_SYMBOL_CONFIGS: Dict[str, Dict[str, Any]] = {
    "XAUUSD": {"tp1_mult": 0.25, "tp2_mult": 1.80, "sl_mult": 0.25, "trail_runner": False},
    "BTCUSD": {"tp1_mult": 0.22, "tp2_mult": 2.50, "sl_mult": 0.20, "trail_runner": True},
    "GBPUSD": {"tp1_mult": 0.25, "tp2_mult": 2.20, "sl_mult": 0.20, "trail_runner": True},
    "GBPJPY": {"tp1_mult": 0.22, "tp2_mult": 2.00, "sl_mult": 0.22, "trail_runner": True},
    "USDJPY": {"tp1_mult": 0.25, "tp2_mult": 2.50, "sl_mult": 0.25, "trail_runner": False},
}

def get_champion_config(symbol: str) -> Dict[str, Any]:
    base = clean_base_symbol(symbol).upper()
    for key, cfg in CHAMPION_SYMBOL_CONFIGS.items():
        if key in base:
            return cfg
    return {"tp1_mult": 0.22, "tp2_mult": 2.00, "sl_mult": 0.25, "trail_runner": True}


class ScalperBot:
    ALLOWED_STRATEGIES = ("CHAMPION_SCALPER", "HAIDER_ENHANCED", "REAL_DIP")

    def __init__(self, store=None, mt5_lock: Optional[threading.RLock] = None):
        self.store = store or app_store
        self.mt5_lock = mt5_lock or threading.RLock()
        
        # Configuration
        self.enabled = False
        self.strategy = "HAIDER_ENHANCED"  # default strategy
        self.symbols = list(DEFAULT_SYMBOLS)
        self.max_instruments = MAX_INSTRUMENTS
        self.timeframe_str = "5M"
        self.lot_size = 0.10
        self.symbol_lot_sizes: Dict[str, float] = {}
        self.max_gold_lot = 1.0  # Mandatory safety cap: <= 1.0 lot on Gold

        # Isolated Per-Strategy Configurations (instruments & lot sizes)
        self.strategy_configs: Dict[str, Dict[str, Any]] = {
            "HAIDER_ENHANCED": {
                "enabled": False,
                "symbols": ["XAUUSDm"],
                "symbol_lot_sizes": {"XAUUSDm": 0.10}
            },
            "CHAMPION_SCALPER": {
                "enabled": False,
                "symbols": ["BTCUSDm", "XAUUSDm", "GBPUSDm", "GBPJPYm", "USDJPYm"],
                "symbol_lot_sizes": {
                    "BTCUSDm": 1.0,
                    "XAUUSDm": 0.10,
                    "GBPUSDm": 0.10,
                    "GBPJPYm": 0.10,
                    "USDJPYm": 0.10
                }
            }
        }
        
        # Strategy parameters (Haider-Scalper-Enhanced)
        self.atr_len = 14
        self.impulse_mult = 1.0
        self.rsi_len = 14
        self.rsi_buy_level = 36.0
        self.rsi_sell_level = 64.0
        self.target_level = 50.0
        self.sl_buffer = 1.35  # Anti-Hunt Buffer (1.35x ATR)
        self.min_wick_ratio = 0.18  # Rejection Wick confirmation (>= 18%)
        self.skip_rollover = True   # Spread defense 21:00-22:30 UTC
        
        # State tracking
        self.is_running = False
        self._stop_event = threading.Event()
        self._worker_thread: Optional[threading.Thread] = None
        self._autobe_thread: Optional[threading.Thread] = None
        
        self.status_message = "INITIALIZING"
        self.active_bot_orders: Dict[int, Dict[str, Any]] = {}
        self.last_trade: Optional[Dict[str, Any]] = None
        
        # Per-symbol state tracking: symbol -> state dict
        self.symbol_states: Dict[str, Dict[str, Any]] = {}

        # Load persisted settings from database
        self.load_settings()

    def load_settings(self):
        """Load persisted settings from store (JSON DB)."""
        if not self.store:
            return
        try:
            saved = self.store.get("settings", "scalper_bot", {})
            if not isinstance(saved, dict):
                saved = {}
            if "enabled" in saved:
                self.enabled = bool(saved.get("enabled", False))
            if "strategy" in saved and saved["strategy"] in ("CHAMPION_SCALPER", "HAIDER_ENHANCED", "REAL_DIP"):
                self.strategy = saved["strategy"]
            if "lot_size" in saved:
                self.lot_size = float(saved.get("lot_size", 0.10))

            # Merge per-strategy configurations
            saved_strat_configs = self.store.get("settings", "strategy_configs")
            if isinstance(saved_strat_configs, dict):
                for k in ("HAIDER_ENHANCED", "CHAMPION_SCALPER"):
                    if k in saved_strat_configs and isinstance(saved_strat_configs[k], dict):
                        self.strategy_configs[k].update(saved_strat_configs[k])
                        for sym, l in list(self.strategy_configs[k].get("symbol_lot_sizes", {}).items()):
                            try:
                                val = float(l)
                                if "XAU" in str(sym).upper() or "GOLD" in str(sym).upper():
                                    val = min(self.max_gold_lot, val)
                                self.strategy_configs[k]["symbol_lot_sizes"][sym] = round(max(0.01, val), 2)
                            except Exception:
                                pass

            # Merge from both "settings.symbol_lot_sizes" and "settings.scalper_bot.symbol_lot_sizes"
            standalone_lots = self.store.get("settings", "symbol_lot_sizes") or {}
            bot_lots = saved.get("symbol_lot_sizes") or {}
            combined_lots = {}
            if isinstance(standalone_lots, dict):
                combined_lots.update(standalone_lots)
            if isinstance(bot_lots, dict):
                combined_lots.update(bot_lots)

            for s, l in combined_lots.items():
                try:
                    val = float(l)
                    if "XAU" in str(s).upper() or "GOLD" in str(s).upper():
                        val = min(self.max_gold_lot, val)
                    clamped = round(max(0.01, val), 2)
                    clean_s = str(s).strip()
                    self.symbol_lot_sizes[clean_s] = clamped
                    base_s = clean_base_symbol(clean_s)
                    if base_s and base_s not in self.symbol_lot_sizes:
                        self.symbol_lot_sizes[base_s] = clamped
                except Exception:
                    pass

            saved_syms = saved.get("symbols") or self.store.get("settings", "scalper_symbols")
            if isinstance(saved_syms, list) and len(saved_syms) > 0:
                self.symbols = [str(s).strip() for s in saved_syms if s][:MAX_INSTRUMENTS]
            elif saved.get("symbol"):
                self.symbols = [str(saved.get("symbol")).strip()]
        except Exception as e:
            logger.warning(f"Failed to load bot settings: {e}")

        # Ensure at least 1 symbol
        if not self.symbols:
            self.symbols = list(DEFAULT_SYMBOLS)

    def _get_symbol_state(self, sym: str) -> Dict[str, Any]:
        if sym not in self.symbol_states:
            self.symbol_states[sym] = {
                "broker_symbol": sym,
                "last_bar_time": 0,
                "setup_state": 0,  # 1 = SELL setup, -1 = BUY setup
                "setup_high": 0.0,
                "setup_low": 0.0,
                "setup_range": 0.0,
                "setup_tp": 0.0,
                "setup_sl": 0.0,
                "setup_bar_time": 0,
                "last_signal": None,
                "last_scanned_at": 0,
                "scan_status": "PENDING"
            }
        return self.symbol_states[sym]

    def start(self):
        """Start the background daemon threads."""
        if self.is_running:
            return
        self._stop_event.clear()
        self.is_running = True
        self.status_message = "RUNNING"
        
        self._worker_thread = threading.Thread(target=self._worker_loop, daemon=True, name="ScalperBot-MultiWorker")
        self._worker_thread.start()
        
        self._autobe_thread = threading.Thread(target=self._autobe_loop, daemon=True, name="ScalperBot-AutoBE")
        self._autobe_thread.start()
        syms_str = ", ".join(self.symbols)
        print(f"[SCALPER_BOT] >>> Autonomous Multi-Instrument Scalper Daemon started for [{syms_str}] (Strategy: {self.strategy})", flush=True)

    def stop(self):
        """Stop the background daemon threads."""
        self.is_running = False
        self._stop_event.set()
        self.status_message = "STOPPED"
        print("[SCALPER_BOT] <<< Autonomous Scalper Daemon stopped.", flush=True)

    def configure(self, enabled: Optional[bool] = None, strategy: Optional[str] = None,
                  lot_size: Optional[float] = None, symbol: Optional[str] = None,
                  symbols: Optional[List[str]] = None,
                  symbol_lot_sizes: Optional[Dict[str, float]] = None,
                  strategies: Optional[Dict[str, Any]] = None,
                  strategy_configs: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Update bot configuration, active pairs (up to 10), per-instrument lot sizes, and persist."""
        strat_map = strategies or strategy_configs
        if strat_map and isinstance(strat_map, dict):
            for k, v in strat_map.items():
                s_key = str(k).upper().replace("-", "_")
                if s_key in self.strategy_configs:
                    if isinstance(v, dict):
                        self.strategy_configs[s_key]["enabled"] = bool(v.get("enabled", False))
                    else:
                        self.strategy_configs[s_key]["enabled"] = bool(v)

        if enabled is not None:
            self.enabled = bool(enabled)
            if not self.enabled:
                # Disabling master auto-trade disables all strategies
                for c in self.strategy_configs.values():
                    c["enabled"] = False
            elif not strat_map:
                # If master enabled is True and no specific strat_map was passed, enable the single active strategy
                strat_key = (strategy or self.strategy or "HAIDER_ENHANCED").upper().replace("-", "_")
                for k, c in self.strategy_configs.items():
                    c["enabled"] = (k == strat_key)

        if strategy in ("CHAMPION_SCALPER", "HAIDER_ENHANCED", "REAL_DIP"):
            self.strategy = strategy

        # Update master self.enabled to True if any strategy is enabled, or if explicitly enabled
        any_enabled = any(c.get("enabled", False) for c in self.strategy_configs.values())
        if self.enabled or any_enabled:
            self.enabled = True
            if not self.is_running:
                self.start()
        else:
            self.enabled = False
            if self.is_running:
                self.stop()
        if lot_size is not None:
            # Strictly cap Gold at 1.0
            val = max(0.01, min(self.max_gold_lot, float(lot_size)))
            self.lot_size = round(val, 2)
        if symbol_lot_sizes is not None and isinstance(symbol_lot_sizes, dict):
            for s, v in symbol_lot_sizes.items():
                try:
                    val = float(v)
                    if "XAU" in str(s).upper() or "GOLD" in str(s).upper():
                        val = min(self.max_gold_lot, val)
                    clamped = round(max(0.01, val), 2)
                    clean_s = str(s).strip()
                    self.symbol_lot_sizes[clean_s] = clamped
                    base_s = clean_base_symbol(clean_s)
                    if base_s:
                        self.symbol_lot_sizes[base_s] = clamped
                        # Synchronize all existing keys sharing the same base symbol
                        for k in list(self.symbol_lot_sizes.keys()):
                            if clean_base_symbol(k) == base_s:
                                self.symbol_lot_sizes[k] = clamped
                except (ValueError, TypeError):
                    pass
        if symbols is not None and isinstance(symbols, list):
            cleaned = []
            for s in symbols:
                s_str = str(s).strip()
                if s_str and s_str not in cleaned:
                    cleaned.append(s_str)
            if cleaned:
                self.symbols = cleaned[:MAX_INSTRUMENTS]
        elif symbol:
            s_clean = str(symbol).strip()
            if s_clean and s_clean not in self.symbols:
                self.symbols = [s_clean] + [x for x in self.symbols if x != s_clean][:MAX_INSTRUMENTS - 1]

        if self.store:
            try:
                bot_data = {
                    "enabled": self.enabled,
                    "strategy": self.strategy,
                    "lot_size": self.lot_size,
                    "symbol_lot_sizes": self.symbol_lot_sizes,
                    "symbols": self.symbols,
                    "symbol": self.symbols[0] if self.symbols else "XAUUSDc"
                }
                self.store.put("settings", "scalper_bot", bot_data)
                self.store.put("settings", "scalper_symbols", self.symbols)
                self.store.put("settings", "symbol_lot_sizes", self.symbol_lot_sizes)
                self.store.put("settings", "strategy_configs", self.strategy_configs)
            except Exception as e:
                logger.warning(f"Failed to persist bot settings: {e}")
        return self.status()

    def configure_strategy(self, strategy_key: str, enabled: Optional[bool] = None,
                           symbols: Optional[List[str]] = None,
                           symbol_lot_sizes: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        """Configure an isolated strategy (HAIDER_ENHANCED or CHAMPION_SCALPER) with its own symbols and lot sizes."""
        strat_key = strategy_key.upper().replace("-", "_")
        if strat_key not in self.strategy_configs:
            self.strategy_configs[strat_key] = {
                "enabled": False,
                "symbols": ["XAUUSDm"],
                "symbol_lot_sizes": {"XAUUSDm": 0.10}
            }

        cfg = self.strategy_configs[strat_key]

        if enabled is not None:
            cfg["enabled"] = bool(enabled)

        if symbols is not None and isinstance(symbols, list):
            cleaned = []
            for s in symbols:
                s_str = str(s).strip()
                if s_str and s_str not in cleaned:
                    cleaned.append(s_str)
            if cleaned:
                cfg["symbols"] = cleaned[:MAX_INSTRUMENTS]

        if symbol_lot_sizes is not None and isinstance(symbol_lot_sizes, dict):
            if "symbol_lot_sizes" not in cfg:
                cfg["symbol_lot_sizes"] = {}
            for s, v in symbol_lot_sizes.items():
                try:
                    val = float(v)
                    if "XAU" in str(s).upper() or "GOLD" in str(s).upper():
                        val = min(self.max_gold_lot, val)
                    clamped = round(max(0.01, val), 2)
                    clean_s = str(s).strip()
                    cfg["symbol_lot_sizes"][clean_s] = clamped
                    base_s = clean_base_symbol(clean_s)
                    if base_s:
                        cfg["symbol_lot_sizes"][base_s] = clamped
                except (ValueError, TypeError):
                    pass

        # Collect union of all strategy symbols to keep self.symbols and worker loop synchronized
        all_strat_syms = []
        for c in self.strategy_configs.values():
            for s in c.get("symbols", []):
                if s and s not in all_strat_syms:
                    all_strat_syms.append(s)
        if all_strat_syms:
            self.symbols = all_strat_syms[:MAX_INSTRUMENTS]

        # Update master self.enabled to True if any strategy is enabled
        any_enabled = any(c.get("enabled", False) for c in self.strategy_configs.values())
        if any_enabled:
            self.enabled = True
            if not self.is_running:
                self.start()
        else:
            self.enabled = False
            if self.is_running:
                self.stop()

        # Persist
        if self.store:
            try:
                self.store.put("settings", "strategy_configs", self.strategy_configs)
                self.store.put("settings", "scalper_symbols", self.symbols)
            except Exception as e:
                logger.warning(f"Failed to persist strategy_configs: {e}")

        return self.status()

    def status(self) -> Dict[str, Any]:
        """Return comprehensive telemetry of the bot for the UI and APIs."""
        algo_allowed = False
        mt5_connected = False
        account_trade_allowed = False

        if MT5_AVAILABLE:
            try:
                with self.mt5_lock:
                    t_info = mt5.terminal_info()
                    a_info = mt5.account_info()
                    if t_info:
                        mt5_connected = bool(t_info.connected)
                        algo_allowed = bool(t_info.trade_allowed)
                    if a_info:
                        account_trade_allowed = bool(a_info.trade_allowed)
            except Exception:
                pass

        ready_to_trade = self.enabled and self.is_running and mt5_connected and algo_allowed and account_trade_allowed

        # Compile per-symbol summary
        per_symbol_telemetry = {}
        for sym in self.symbols:
            st = self._get_symbol_state(sym)
            per_symbol_telemetry[sym] = {
                "broker_symbol": st.get("broker_symbol", sym),
                "last_bar_time": st["last_bar_time"],
                "last_bar_time_str": datetime.datetime.fromtimestamp(st["last_bar_time"]).strftime("%Y-%m-%d %H:%M:%S") if st["last_bar_time"] else "None",
                "setup_state": st["setup_state"],
                "last_signal": st["last_signal"],
                "scan_status": st["scan_status"]
            }

        return {
            "is_running": self.is_running,
            "enabled": self.enabled,
            "ready_to_trade": ready_to_trade,
            "strategy": self.strategy,
            "symbols": self.symbols,
            "symbol": self.symbols[0] if self.symbols else "XAUUSDc",
            "active_pairs_count": len(self.symbols),
            "max_instruments": self.max_instruments,
            "timeframe": self.timeframe_str,
            "lot_size": self.lot_size,
            "symbol_lot_sizes": self.symbol_lot_sizes,
            "strategy_configs": self.strategy_configs,
            "haider_enhanced": self.strategy_configs.get("HAIDER_ENHANCED", {}),
            "champion_scalper": self.strategy_configs.get("CHAMPION_SCALPER", {}),
            "max_gold_lot": self.max_gold_lot,
            "mt5_connected": mt5_connected,
            "terminal_algo_trading": algo_allowed,
            "account_trade_allowed": account_trade_allowed,
            "status_message": self.status_message,
            "per_symbol": per_symbol_telemetry,
            "last_trade": self.last_trade,
            "active_orders_count": len(self.active_bot_orders),
            "active_orders": list(self.active_bot_orders.values())
        }

    def get_lot_for_symbol(self, symbol: str) -> float:
        """Lookup lot size for symbol checking exact, clean base, and broker resolved."""
        is_gold = "XAU" in str(symbol).upper() or "GOLD" in str(symbol).upper()
        s_clean = str(symbol).strip()
        base = clean_base_symbol(s_clean)
        
        val = None
        if s_clean in self.symbol_lot_sizes:
            val = self.symbol_lot_sizes[s_clean]
        elif base and base in self.symbol_lot_sizes:
            val = self.symbol_lot_sizes[base]
        else:
            # Check any alias sharing the base
            for k, v in self.symbol_lot_sizes.items():
                if base and clean_base_symbol(k) == base:
                    val = v
                    break
        
        if val is None:
            val = self.lot_size
            
        if is_gold:
            val = min(self.max_gold_lot, val)
        return max(0.01, round(float(val), 2))

    # ─────────────────────────────────────────────────────────────────────────
    # Background Worker Loop: Iterates over all active instruments per strategy
    # ─────────────────────────────────────────────────────────────────────────
    def _worker_loop(self):
        while not self._stop_event.is_set():
            try:
                # Check active status of strategies
                haider_cfg = self.strategy_configs.get("HAIDER_ENHANCED", {})
                champ_cfg = self.strategy_configs.get("CHAMPION_SCALPER", {})
                haider_on = haider_cfg.get("enabled", False)
                champ_on = champ_cfg.get("enabled", False)

                if not self.enabled and not haider_on and not champ_on:
                    self.status_message = "STANDBY (Disabled by User)"
                    self._stop_event.wait(3.0)
                    continue

                if not MT5_AVAILABLE:
                    self.status_message = "MT5 module not installed"
                    self._stop_event.wait(5.0)
                    continue

                with self.mt5_lock:
                    t_info = mt5.terminal_info()
                    a_info = mt5.account_info() if t_info and t_info.connected else None

                if not t_info or not t_info.connected:
                    self.status_message = "MT5 Disconnected"
                    self._stop_event.wait(3.0)
                    continue

                if not t_info.trade_allowed:
                    self.status_message = "AlgoTrading is OFF in MT5 desktop (Click Algo Trading or press Ctrl+E)"
                    self._stop_event.wait(2.0)
                    continue

                if a_info and not a_info.trade_allowed:
                    self.status_message = "Trading disabled on this MT5 account"
                    self._stop_event.wait(5.0)
                    continue

                # Build active execution items: (strategy_key, symbol, lot_size)
                active_plans = []
                if haider_on:
                    for s in haider_cfg.get("symbols", []):
                        lot = haider_cfg.get("symbol_lot_sizes", {}).get(s, self.lot_size)
                        active_plans.append(("HAIDER_ENHANCED", s, lot))
                if champ_on:
                    for s in champ_cfg.get("symbols", []):
                        lot = champ_cfg.get("symbol_lot_sizes", {}).get(s, self.lot_size)
                        active_plans.append(("CHAMPION_SCALPER", s, lot))

                # Fallback to legacy single-strategy loop if master enabled but no specific configs enabled
                if not active_plans and self.enabled:
                    for s in self.symbols:
                        active_plans.append((self.strategy, s, self.get_lot_for_symbol(s)))

                for strat_key, config_sym, custom_lot in active_plans:
                    if self._stop_event.is_set():
                        break

                    sym_state_key = f"{strat_key}:{config_sym}"
                    sym_state = self._get_symbol_state(sym_state_key)
                    broker_sym = resolve_broker_symbol(config_sym, self.mt5_lock)
                    sym_state["broker_symbol"] = broker_sym

                    with self.mt5_lock:
                        if not mt5.symbol_select(broker_sym, True):
                            sym_state["scan_status"] = f"SYMBOL_NOT_FOUND ({broker_sym})"
                            continue
                        rates = mt5.copy_rates_from_pos(broker_sym, mt5.TIMEFRAME_M5, 0, 100)

                    if rates is None or len(rates) < 40:
                        sym_state["scan_status"] = "WAITING_FOR_DATA"
                        continue

                    sym_state["last_scanned_at"] = int(time.time())
                    sym_state["scan_status"] = f"SCANNING_OK ({broker_sym})"

                    # Bar -1 is currently forming live bar. Bar -2 is the most recently CLOSED bar.
                    closed_bar = rates[-2]
                    closed_bar_time = int(closed_bar["time"])
                    current_bar = rates[-1]

                    if sym_state["last_bar_time"] == 0:
                        # Initial sync on startup: record current bar timestamp to prevent firing stale historical bars
                        sym_state["last_bar_time"] = closed_bar_time
                        sym_state["scan_status"] = f"SYNCED_AWAITING_BAR_CLOSE ({broker_sym})"
                        continue

                    # Check if a new candle closed for this specific instrument
                    if closed_bar_time > sym_state["last_bar_time"]:
                        sym_state["last_bar_time"] = closed_bar_time
                        self._process_closed_bar_for_symbol(
                            broker_sym,
                            sym_state,
                            rates[:-1],
                            current_bar,
                            config_sym=config_sym,
                            strategy_name=strat_key,
                            custom_lot=custom_lot
                        )

                active_strats = []
                if haider_on: active_strats.append(f"Haider({len(haider_cfg.get('symbols', []))})")
                if champ_on: active_strats.append(f"Champion({len(champ_cfg.get('symbols', []))})")
                self.status_message = f"ACTIVE: Monitoring {' + '.join(active_strats) if active_strats else len(active_plans)} Pairs on 5M"

            except Exception as e:
                logger.error(f"Error in multi-instrument worker loop: {e}", exc_info=True)
                self.status_message = f"Error: {str(e)[:40]}"

            self._stop_event.wait(1.0)

    def _has_open_position(self, symbol: str) -> bool:
        """Check if bot already has an active open position for this symbol to prevent duplicate entries."""
        # 1. Check in-memory active orders
        for trade in self.active_bot_orders.values():
            if trade.get("symbol") == symbol:
                return True

        # 2. Check directly in MT5 for any position with ScalperBot magic number (999333)
        if MT5_AVAILABLE:
            try:
                with self.mt5_lock:
                    positions = mt5.positions_get(symbol=symbol)
                    if positions:
                        for p in positions:
                            if getattr(p, "magic", None) == 999333:
                                return True
            except Exception:
                pass
        return False

    # ─────────────────────────────────────────────────────────────────────────
    # Closed Bar Setup Evaluator for a Specific Symbol & Strategy
    # ─────────────────────────────────────────────────────────────────────────
    def _process_closed_bar_for_symbol(self, broker_sym: str, sym_state: Dict[str, Any], closed_rates, current_bar,
                                       config_sym: Optional[str] = None, strategy_name: Optional[str] = None,
                                       custom_lot: Optional[float] = None):
        if config_sym is None:
            config_sym = broker_sym
        active_strat = strategy_name if strategy_name else self.strategy
        n = len(closed_rates)
        if n < 20:
            return

        # Safeguard: prevent opening duplicate positions if a bot trade is already active on this symbol
        if self._has_open_position(broker_sym):
            sym_state["scan_status"] = f"POSITION_ACTIVE ({broker_sym})"
            return

        highs = [float(r["high"]) for r in closed_rates]
        lows = [float(r["low"]) for r in closed_rates]
        closes = [float(r["close"]) for r in closed_rates]
        opens = [float(r["open"]) for r in closed_rates]
        times = [int(r["time"]) for r in closed_rates]

        atr = wilder_atr(highs, lows, closes, self.atr_len)
        rsi = wilder_rsi(closes, self.rsi_len)

        curr_bar_idx = n - 1
        curr_atr = atr[curr_bar_idx]
        curr_rsi = rsi[curr_bar_idx]
        c = closes[curr_bar_idx]
        o = opens[curr_bar_idx]
        h = highs[curr_bar_idx]
        l = lows[curr_bar_idx]
        t = times[curr_bar_idx]

        dt = datetime.datetime.fromtimestamp(t, tz=datetime.timezone.utc)

        # Evaluate current closed bar for signal setup
        if curr_atr is None or curr_rsi is None:
            return

        # Toxic rollover defense (21:00-22:30 UTC spread widening)
        if self.skip_rollover and (dt.hour == 21 or (dt.hour == 22 and dt.minute <= 30)):
            return

        cbody = abs(c - o)
        crange = h - l
        if crange <= 0:
            return

        lower_wick = (min(o, c) - l) / crange
        upper_wick = (h - max(o, c)) / crange

        if active_strat == "CHAMPION_SCALPER":
            # 1. Microstructure Liquidity Sweep (8-bar lookback)
            sweep_n = min(8, n - 1)
            prev_highs = highs[-1 - sweep_n:-1]
            prev_lows = lows[-1 - sweep_n:-1]
            swept_high = (h > max(prev_highs)) if prev_highs else True
            swept_low = (l < min(prev_lows)) if prev_lows else True

            # 2. 20-period Bollinger Band extremes
            bb_upper = None
            bb_lower = None
            if n >= 20:
                w = closes[-20:]
                m = sum(w) / 20.0
                s = math.sqrt(sum((x - m) ** 2 for x in w) / 20.0)
                bb_upper = m + 1.8 * s
                bb_lower = m - 1.8 * s

            bb_lower_hit = (l <= bb_lower) if bb_lower is not None else True
            bb_upper_hit = (h >= bb_upper) if bb_upper is not None else True

            # 3. 50 EMA & 200 EMA trend alignment
            trend_bull = True
            trend_bear = True
            if n >= 50:
                k50 = 2.0 / 51.0
                ema50 = closes[0]
                for val in closes[1:]:
                    ema50 = val * k50 + ema50 * (1.0 - k50)
                trend_bull = c > ema50
                trend_bear = c < ema50

            is_buy = (c < o) and (cbody >= curr_atr * 0.65) and (lower_wick >= 0.22) and (curr_rsi <= 30.0) and bb_lower_hit and swept_low
            is_sell = (c > o) and (cbody >= curr_atr * 0.65) and (upper_wick >= 0.22) and (curr_rsi >= 70.0) and bb_upper_hit and swept_high

            if is_buy and not trend_bull and curr_rsi >= 26.0:
                is_buy = False
            if is_sell and not trend_bear and curr_rsi <= 74.0:
                is_sell = False

            strat_name = "Champion-Scalper"
            sym_cfg = get_champion_config(broker_sym)
            sl_buffer_mult = sym_cfg["sl_mult"]
            tp1_atr_mult = sym_cfg["tp1_mult"]
            tp2_atr_mult = sym_cfg["tp2_mult"]

        elif active_strat == "HAIDER_ENHANCED":
            is_buy = (c < o) and (cbody > curr_atr * self.impulse_mult) and (curr_rsi < self.rsi_buy_level) and (lower_wick >= self.min_wick_ratio)
            is_sell = (c > o) and (cbody > curr_atr * self.impulse_mult) and (curr_rsi > self.rsi_sell_level) and (upper_wick >= self.min_wick_ratio)
            sl_buffer_mult = self.sl_buffer  # 1.35x ATR
            strat_name = "Haider-Scalper-Enhanced"
            tp1_atr_mult = None
            tp2_atr_mult = 2.2
        else:
            # Baseline REAL_DIP
            is_buy = (c < o) and (cbody > curr_atr * self.impulse_mult) and (curr_rsi < self.rsi_buy_level)
            is_sell = (c > o) and (cbody > curr_atr * self.impulse_mult) and (curr_rsi > self.rsi_sell_level)
            sl_buffer_mult = 1.0
            strat_name = "Haider-Gold-Scalper"
            tp1_atr_mult = None
            tp2_atr_mult = 2.2

        if is_sell:
            entry = float(current_bar["open"])
            if active_strat == "CHAMPION_SCALPER":
                tp1 = entry - (curr_atr * tp1_atr_mult)
                sl = h + (curr_atr * sl_buffer_mult)
            else:
                tp1 = h - (crange * (self.target_level / 100.0))
                sl = h + (curr_atr * sl_buffer_mult)

            sym_state["setup_state"] = 1
            sym_state["setup_high"] = h
            sym_state["setup_low"] = l
            sym_state["setup_range"] = crange
            sym_state["setup_tp"] = tp1
            sym_state["setup_sl"] = sl
            sym_state["setup_bar_time"] = t
            sym_state["last_signal"] = {
                "symbol": broker_sym,
                "config_symbol": config_sym,
                "type": "SELL",
                "time": t,
                "strategy": active_strat,
                "sl": sl,
                "tp1": tp1
            }
            print(f"[SCALPER_BOT] >>> SELL Signal ({active_strat}) on {broker_sym} @ {entry:.3f}! Executing trade immediately (< 3s)...", flush=True)
            if custom_lot is not None:
                try:
                    self._execute_signal(
                        symbol=broker_sym,
                        signal_type="SELL",
                        entry=entry,
                        sl=sl,
                        tp1=tp1,
                        strategy_name=strat_name,
                        custom_lot=custom_lot
                    )
                except TypeError:
                    self._execute_signal(
                        symbol=broker_sym,
                        signal_type="SELL",
                        entry=entry,
                        sl=sl,
                        tp1=tp1,
                        strategy_name=strat_name
                    )
            else:
                self._execute_signal(
                    symbol=broker_sym,
                    signal_type="SELL",
                    entry=entry,
                    sl=sl,
                    tp1=tp1,
                    strategy_name=strat_name
                )

        elif is_buy:
            entry = float(current_bar["open"])
            if active_strat == "CHAMPION_SCALPER":
                tp1 = entry + (curr_atr * tp1_atr_mult)
                sl = l - (curr_atr * sl_buffer_mult)
            else:
                tp1 = l + (crange * (self.target_level / 100.0))
                sl = l - (curr_atr * sl_buffer_mult)

            sym_state["setup_state"] = -1
            sym_state["setup_high"] = h
            sym_state["setup_low"] = l
            sym_state["setup_range"] = crange
            sym_state["setup_tp"] = tp1
            sym_state["setup_sl"] = sl
            sym_state["setup_bar_time"] = t
            sym_state["last_signal"] = {
                "symbol": broker_sym,
                "config_symbol": config_sym,
                "type": "BUY",
                "time": t,
                "strategy": active_strat,
                "sl": sl,
                "tp1": tp1
            }
            print(f"[SCALPER_BOT] >>> BUY Signal ({active_strat}) on {broker_sym} @ {entry:.3f}! Executing trade immediately (< 3s)...", flush=True)
            if custom_lot is not None:
                try:
                    self._execute_signal(
                        symbol=broker_sym,
                        signal_type="BUY",
                        entry=entry,
                        sl=sl,
                        tp1=tp1,
                        strategy_name=strat_name,
                        custom_lot=custom_lot
                    )
                except TypeError:
                    self._execute_signal(
                        symbol=broker_sym,
                        signal_type="BUY",
                        entry=entry,
                        sl=sl,
                        tp1=tp1,
                        strategy_name=strat_name
                    )
            else:
                self._execute_signal(
                    symbol=broker_sym,
                    signal_type="BUY",
                    entry=entry,
                    sl=sl,
                    tp1=tp1,
                    strategy_name=strat_name
                )

    # ─────────────────────────────────────────────────────────────────────────
    # 2-Tranche Institutional Execution with Auto-BE Registration
    # ─────────────────────────────────────────────────────────────────────────
    def _execute_signal(self, symbol: str, signal_type: str, entry: float, sl: float, tp1: float, strategy_name: str,
                        custom_lot: Optional[float] = None, **kwargs):
        # Strict user risk constraint: Gold lot size <= 1.0
        is_gold = "XAU" in symbol.upper() or "GOLD" in symbol.upper()
        if custom_lot is not None:
            raw_lot = float(custom_lot)
        else:
            raw_lot = self.get_lot_for_symbol(symbol)
        total_lot = min(self.max_gold_lot, raw_lot) if is_gold else raw_lot
        total_lot = max(0.01, round(total_lot, 2))

        strat = "CHAMPION_SCALPER" if ("Champion" in strategy_name or strategy_name == "CHAMPION_SCALPER") else ("HAIDER_ENHANCED" if "Enhanced" in strategy_name or strategy_name == "HAIDER_ENHANCED" else self.strategy)
        direction = 1 if signal_type == "BUY" else -1
        t_dist = abs(tp1 - entry)
        if strat == "CHAMPION_SCALPER":
            sym_cfg = get_champion_config(symbol)
            ratio = (sym_cfg["tp2_mult"] / sym_cfg["tp1_mult"]) if sym_cfg.get("tp1_mult") else 8.0
            tp2 = (entry + t_dist * ratio) if direction == 1 else max(0.001, entry - t_dist * ratio)
            trail_active = sym_cfg.get("trail_runner", False)
        else:
            tp2 = (entry + t_dist * 2.2) if direction == 1 else max(0.001, entry - t_dist * 2.2)
            trail_active = False

        # Tranche volume calculation
        is_multi_tranche = (strat in ("CHAMPION_SCALPER", "HAIDER_ENHANCED"))
        if strat == "CHAMPION_SCALPER":
            base_label = "Champion-Scalp"
        elif strat == "HAIDER_ENHANCED":
            base_label = "Haider-Enhanced"
        else:
            base_label = "Haider-Gold"

        if total_lot >= 0.02 and is_multi_tranche:
            tranche_1_vol = round(total_lot * 0.5, 2)
            tranche_2_vol = round(total_lot - tranche_1_vol, 2)
            extended_tp = (entry + t_dist * 12.0) if direction == 1 else max(0.001, entry - t_dist * 12.0)
            orders_to_place = [
                {"vol": tranche_1_vol, "tp": tp1, "comment": f"{base_label} [TP1]", "is_runner": False},
                {"vol": tranche_2_vol, "tp": extended_tp, "comment": f"{base_label} [Runner]", "is_runner": True, "auto_be_target": tp1, "tp2_milestone": tp2, "trail_runner": trail_active}
            ]
        else:
            orders_to_place = [
                {"vol": total_lot, "tp": tp1, "comment": base_label, "is_runner": False}
            ]

        executed_orders = []
        for plan in orders_to_place:
            res = self._send_mt5_order(
                symbol=symbol,
                order_type_str=signal_type,
                volume=plan["vol"],
                sl=round(sl, 3 if is_gold else 5),
                tp=round(plan["tp"], 3 if is_gold else 5),
                comment=plan["comment"]
            )
            if res and res.get("order"):
                ticket = res["order"]
                trade_info = {
                    "ticket": ticket,
                    "symbol": symbol,
                    "type": signal_type,
                    "volume": plan["vol"],
                    "entry_price": res.get("price", entry),
                    "sl": round(sl, 3 if is_gold else 5),
                    "tp": round(plan["tp"], 3 if is_gold else 5),
                    "is_runner": plan.get("is_runner", False),
                    "auto_be_target": plan.get("auto_be_target"),
                    "tp2_milestone": plan.get("tp2_milestone", tp2),
                    "trail_runner": plan.get("trail_runner", False),
                    "be_done": False,
                    "opened_at": int(time.time()),
                    "comment": plan["comment"]
                }
                self.active_bot_orders[ticket] = trade_info
                executed_orders.append(trade_info)

                # Register open runner with Neural Sentinel for live multi-neuron follow-up
                if plan.get("is_runner"):
                    neural_sentinel.register_trade(
                        ticket=ticket,
                        symbol=symbol,
                        direction=direction,
                        entry_price=trade_info["entry_price"],
                        initial_sl=trade_info["sl"],
                        tp1=trade_info["auto_be_target"],
                        tp2=plan.get("tp2_milestone", tp2),
                        volume=plan["vol"],
                        atr=t_dist / 0.22 if t_dist > 0 else 1.0
                    )

                # Sync into AUTO_BE_TRACKER for app-wide consistency
                if plan.get("is_runner") and plan.get("auto_be_target"):
                    try:
                        from app import AUTO_BE_TRACKER
                        AUTO_BE_TRACKER[ticket] = {
                            "symbol": symbol,
                            "type": signal_type,
                            "open_price": res.get("price", entry),
                            "tp1": plan["auto_be_target"],
                            "tp": round(plan["tp"], 3 if is_gold else 5),
                            "sl": round(sl, 3 if is_gold else 5),
                            "be_done": False
                        }
                    except Exception:
                        pass

        if executed_orders:
            self.last_trade = {
                "time": int(time.time()),
                "signal_type": signal_type,
                "symbol": symbol,
                "strategy": strategy_name,
                "orders": executed_orders
            }
            summary_msg = f"Autonomous MT5 Execution: Opened {len(executed_orders)} Tranche(s) for {signal_type} {symbol} (Total {total_lot} Lots, SL: {sl:.3f}, TP1: {tp1:.3f})"
            print(f"[SCALPER_BOT] >>> {summary_msg}", flush=True)

            send_discord_alert(
                title=f"🤖 Autonomous Scalper Trade: {signal_type} {symbol}",
                description=f"Executed **{len(executed_orders)} Tranche(s)** on MetaTrader 5 without user interference.\n"
                            f"• Total Volume: `{total_lot:.2f} lots`\n"
                            f"• Stop Loss: `{sl:.3f}`\n"
                            f"• Target TP1: `{tp1:.3f}`\n"
                            f"• Target TP2 Runner: `{tp2:.3f}`",
                color=0x00f2fe if self.strategy == "HAIDER_ENHANCED" else 0x089981
            )

    def _send_mt5_order(self, symbol: str, order_type_str: str, volume: float, sl: float, tp: float, comment: str) -> Optional[Dict[str, Any]]:
        """Direct, thread-safe MT5 order submission with volume stepping, digits rounding, and filling fallbacks."""
        if not MT5_AVAILABLE:
            return None

        symbol = resolve_broker_symbol(symbol, self.mt5_lock)
        with self.mt5_lock:
            if not mt5.symbol_select(symbol, True):
                print(f"[SCALPER_BOT] Symbol select failed for {symbol}", flush=True)
                return None

            s_info = mt5.symbol_info(symbol)
            tick = mt5.symbol_info_tick(symbol)
            if not s_info or not tick:
                return None

            is_gold = "XAU" in symbol.upper() or "GOLD" in symbol.upper()
            digits = int(s_info.digits) if (s_info and s_info.digits is not None) else (3 if is_gold else 5)

            # Volume step rounding & broker min/max bounds checking
            vol_min = float(s_info.volume_min or 0.01)
            vol_max = float(s_info.volume_max or 100.0)
            vol_step = float(s_info.volume_step or 0.01)
            steps = round(volume / vol_step)
            safe_volume = max(vol_min, min(vol_max, round(steps * vol_step, 2)))

            price = round(float(tick.ask) if order_type_str == "BUY" else float(tick.bid), digits)
            action_type = mt5.ORDER_TYPE_BUY if order_type_str == "BUY" else mt5.ORDER_TYPE_SELL

            sl = round(sl, digits)
            tp = round(tp, digits)

            # Build prioritized list of valid filling modes for this broker symbol
            mode = s_info.filling_mode
            filling_candidates = []
            if mode & 2 or mode == 2: filling_candidates.append(mt5.ORDER_FILLING_IOC)
            if mode & 1 or mode == 1: filling_candidates.append(mt5.ORDER_FILLING_FOK)
            if mode & 4 or mode == 4: filling_candidates.append(mt5.ORDER_FILLING_RETURN)
            if not filling_candidates:
                filling_candidates = [mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN, mt5.ORDER_FILLING_FOK]

            done_codes = (mt5.TRADE_RETCODE_DONE, getattr(mt5, 'TRADE_RETCODE_PLACED', 10008))

            for filling in filling_candidates:
                req = {
                    "action": mt5.TRADE_ACTION_DEAL,
                    "symbol": symbol,
                    "volume": safe_volume,
                    "type": action_type,
                    "price": price,
                    "sl": sl,
                    "tp": tp,
                    "deviation": 30,
                    "magic": 999333,  # ScalperBot magic number
                    "comment": str(comment or "")[:27],
                    "type_time": mt5.ORDER_TIME_GTC,
                    "type_filling": filling,
                }

                res = mt5.order_send(req)
                if res and res.retcode in done_codes:
                    return {
                        "order": res.order,
                        "deal": res.deal,
                        "price": res.price or price,
                        "retcode": res.retcode
                    }

                # If rejected due to filling mode, immediately try next supported filling candidate
                invalid_fill_code = getattr(mt5, 'TRADE_RETCODE_INVALID_FILL', 10030)
                if res and res.retcode == invalid_fill_code:
                    continue

                # If fast price requote occurred, refresh tick and retry once
                requote_codes = (getattr(mt5, 'TRADE_RETCODE_REQUOTE', 10004), getattr(mt5, 'TRADE_RETCODE_PRICE_CHANGED', 10020))
                if res and res.retcode in requote_codes:
                    fresh_tick = mt5.symbol_info_tick(symbol)
                    if fresh_tick:
                        fresh_px = round(float(fresh_tick.ask if order_type_str == "BUY" else fresh_tick.bid), digits)
                        req["price"] = fresh_px
                        retry_res = mt5.order_send(req)
                        if retry_res and retry_res.retcode in done_codes:
                            return {
                                "order": retry_res.order,
                                "deal": retry_res.deal,
                                "price": retry_res.price or fresh_px,
                                "retcode": retry_res.retcode
                            }

                # Other failure code
                ret = res.retcode if res else "None"
                comm = res.comment if res else "Unknown"
                print(f"[SCALPER_BOT] Order failed on {symbol}: retcode={ret}, comment={comm}", flush=True)
                return None

            return None

    # ─────────────────────────────────────────────────────────────────────────
    # Autonomous 1-Second Auto-Breakeven Engine Loop
    # ─────────────────────────────────────────────────────────────────────────
    def _autobe_loop(self):
        """Continuous high-frequency tick monitor for Auto-BE on Tranche 2 runners across all symbols."""
        while not self._stop_event.is_set():
            try:
                if not MT5_AVAILABLE:
                    self._stop_event.wait(1.0)
                    continue

                with self.mt5_lock:
                    positions = mt5.positions_get()

                if not positions:
                    self.active_bot_orders.clear()
                    self._stop_event.wait(1.0)
                    continue

                open_tickets = {p.ticket: p for p in positions}

                # Clean up closed tickets
                closed_tickets = [t for t in self.active_bot_orders if t not in open_tickets]
                for ct in closed_tickets:
                    self.active_bot_orders.pop(ct, None)
                    neural_sentinel.unregister_trade(ct)

                # Reconcile / adopt any untracked ScalperBot orders (e.g. after daemon restart)
                for p in positions:
                    if getattr(p, "magic", None) == 999333 and p.ticket not in self.active_bot_orders:
                        cmt = getattr(p, "comment", "") or ""
                        is_runner = "[Runner]" in cmt or "Runner" in cmt
                        # Derive Auto-BE target for runner: 50% retracement of impulse
                        target_be = (float(p.price_open) + (abs(float(p.tp) - float(p.price_open)) / 2.2)) if is_runner and p.tp else None
                        self.active_bot_orders[p.ticket] = {
                            "ticket": p.ticket,
                            "symbol": p.symbol,
                            "type": "BUY" if p.type == 0 else "SELL",
                            "volume": float(p.volume),
                            "entry_price": float(p.price_open),
                            "sl": float(p.sl),
                            "tp": float(p.tp),
                            "is_runner": is_runner,
                            "auto_be_target": target_be,
                            "be_done": False,
                            "opened_at": int(getattr(p, "time", time.time())),
                            "comment": cmt
                        }
                        if is_runner and p.ticket not in neural_sentinel.active_tracks:
                            direction = 1 if p.type == 0 else -1
                            t_dist = abs(float(p.tp) - float(p.price_open)) / 6.0 if p.tp else 1.0
                            neural_sentinel.register_trade(
                                ticket=p.ticket,
                                symbol=p.symbol,
                                direction=direction,
                                entry_price=float(p.price_open),
                                initial_sl=float(p.sl),
                                tp1=target_be or (float(p.price_open) + direction * t_dist),
                                tp2=float(p.tp) if p.tp else (float(p.price_open) + direction * t_dist * 2.5),
                                volume=float(p.volume),
                                atr=t_dist / 0.22 if t_dist > 0 else 1.0
                            )

                for ticket, trade in list(self.active_bot_orders.items()):
                    if not trade.get("auto_be_target"):
                        continue

                    pos = open_tickets.get(ticket)
                    if not pos:
                        continue

                    target_tp1 = trade["auto_be_target"]
                    entry_px = float(pos.price_open)
                    curr_sl = float(pos.sl)
                    is_buy = (pos.type == 0)

                    # 1. Neural Sentinel Multi-Neuron Real-Time Evaluation
                    bars_data = None
                    try:
                        with self.mt5_lock:
                            rates = mt5.copy_rates_from_pos(pos.symbol, mt5.TIMEFRAME_M5, 0, 35)
                        if rates is not None and len(rates) > 10:
                            bars_data = [
                                {"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]), "low": float(r["low"]), "close": float(r["close"])}
                                for r in rates
                            ]
                    except Exception:
                        bars_data = None

                    point = getattr(pos, 'point', 0.001) or 0.001
                    eval_res = neural_sentinel.evaluate_trade(
                        ticket=ticket,
                        current_price=float(pos.price_current),
                        bars=bars_data,
                        point=point
                    )

                    if eval_res.get("should_update_mt5"):
                        new_sl = eval_res["proposed_sl"]
                        digits = getattr(pos, 'digits', 3) if (hasattr(pos, 'digits') and pos.digits is not None) else 3
                        req = {
                            "action": mt5.TRADE_ACTION_SLTP,
                            "position": ticket,
                            "symbol": pos.symbol,
                            "sl": round(new_sl, digits),
                            "tp": float(pos.tp),
                        }
                        with self.mt5_lock:
                            res = mt5.order_send(req)
                        if res and res.retcode in (mt5.TRADE_RETCODE_DONE, getattr(mt5, 'TRADE_RETCODE_PLACED', 10008)):
                            trade["current_sl"] = new_sl
                            print(f"[SCALPER_BOT:NEURAL-RATCHET] >>> Ratcheted SL for #{ticket} ({pos.symbol}) to {new_sl:.3f} | Milestone: {eval_res['milestone']} | Extra Profit Locked: +${eval_res.get('extra_profit_captured', 0):.2f}", flush=True)

                    # If Neural Sentinel is actively managing this runner, it controls all trailing ratchets
                    if ticket in neural_sentinel.active_tracks:
                        continue


                    # 2. Initial Auto-BE to entry price when TP1 reached
                    should_be = False
                    if is_buy and pos.price_current >= target_tp1 and (curr_sl < entry_px or curr_sl == 0.0):
                        should_be = True
                    elif not is_buy and pos.price_current <= target_tp1 and (curr_sl > entry_px or curr_sl == 0.0):
                        should_be = True

                    if should_be:
                        digits = getattr(pos, 'digits', 3) if (hasattr(pos, 'digits') and pos.digits is not None) else 3
                        req = {
                            "action": mt5.TRADE_ACTION_SLTP,
                            "position": ticket,
                            "symbol": pos.symbol,
                            "sl": round(entry_px, digits),
                            "tp": float(pos.tp),
                        }
                        with self.mt5_lock:
                            res = mt5.order_send(req)
                        if res and res.retcode in (mt5.TRADE_RETCODE_DONE, getattr(mt5, 'TRADE_RETCODE_PLACED', 10008)):
                            trade["be_done"] = True
                            print(f"[SCALPER_BOT:AUTO-BE] >>> Moved SL for #{ticket} ({pos.symbol}) to Breakeven @ {entry_px:.3f}!", flush=True)
                            send_discord_alert(
                                title=f"🛡️ Auto-Breakeven Activated: #{ticket} ({pos.symbol})",
                                description=f"Tranche 2 Runner hit TP1 target `{target_tp1:.3f}` on **{pos.symbol}**. Stop Loss automatically moved to Breakeven (`{entry_px:.3f}`). Trade is now 100% risk-free!",
                                color=0x089981
                            )
            except Exception as e:
                logger.error(f"Error in autobe loop: {e}")

            self._stop_event.wait(1.0)


# Global Singleton instance
scalper_bot: Optional[ScalperBot] = None

def get_scalper_bot(store=None, mt5_lock=None) -> ScalperBot:
    global scalper_bot
    if scalper_bot is None:
        scalper_bot = ScalperBot(store=store, mt5_lock=mt5_lock)
    elif store is not None and (scalper_bot.store is None or scalper_bot.store is not store):
        scalper_bot.store = store
        scalper_bot.load_settings()
    return scalper_bot
