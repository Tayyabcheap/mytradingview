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

logger = logging.getLogger("scalper_bot")
logger.setLevel(logging.INFO)

MAX_INSTRUMENTS = 10
DEFAULT_SYMBOLS = ["XAUUSDc"]


class ScalperBot:
    def __init__(self, store=None, mt5_lock: Optional[threading.RLock] = None):
        self.store = store
        self.mt5_lock = mt5_lock or threading.RLock()
        
        # Configuration
        self.enabled = False
        self.strategy = "HAIDER_ENHANCED"  # "HAIDER_ENHANCED" or "REAL_DIP"
        self.symbols = list(DEFAULT_SYMBOLS)
        self.max_instruments = MAX_INSTRUMENTS
        self.timeframe_str = "5M"
        self.lot_size = 0.10
        self.max_gold_lot = 1.0  # Mandatory safety cap: <= 1.0 lot on Gold
        
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

        # Load persisted settings if store available
        if self.store:
            try:
                saved = self.store.get("settings", "scalper_bot", {})
                if isinstance(saved, dict):
                    self.enabled = bool(saved.get("enabled", False))
                    self.strategy = saved.get("strategy", "HAIDER_ENHANCED")
                    self.lot_size = float(saved.get("lot_size", 0.10))
                    saved_syms = saved.get("symbols")
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
                  symbols: Optional[List[str]] = None) -> Dict[str, Any]:
        """Update bot configuration, active pairs (up to 10), and persist."""
        if enabled is not None:
            self.enabled = bool(enabled)
        if strategy in ("HAIDER_ENHANCED", "REAL_DIP"):
            self.strategy = strategy
        if lot_size is not None:
            # Strictly cap Gold at 1.0
            val = max(0.01, min(self.max_gold_lot, float(lot_size)))
            self.lot_size = round(val, 2)
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
                self.store.put("settings", "scalper_bot", {
                    "enabled": self.enabled,
                    "strategy": self.strategy,
                    "lot_size": self.lot_size,
                    "symbols": self.symbols,
                    "symbol": self.symbols[0] if self.symbols else "XAUUSDc"
                })
            except Exception:
                pass
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

    # ─────────────────────────────────────────────────────────────────────────
    # Background Worker Loop: Iterates over all active instruments
    # ─────────────────────────────────────────────────────────────────────────
    def _worker_loop(self):
        while not self._stop_event.is_set():
            try:
                if not self.enabled:
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

                # Iterate through all configured instruments
                active_syms = list(self.symbols)
                for config_sym in active_syms:
                    if self._stop_event.is_set() or not self.enabled:
                        break

                    sym_state = self._get_symbol_state(config_sym)
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
                        self._process_closed_bar_for_symbol(broker_sym, sym_state, rates[:-1], current_bar, config_sym=config_sym)

                self.status_message = f"ACTIVE: Monitoring {len(active_syms)} Pairs simultaneously on 5M"

            except Exception as e:
                logger.error(f"Error in multi-instrument worker loop: {e}", exc_info=True)
                self.status_message = f"Error: {str(e)[:40]}"

            self._stop_event.wait(1.0)

    # ─────────────────────────────────────────────────────────────────────────
    # Closed Bar Setup Evaluator for a Specific Symbol
    # ─────────────────────────────────────────────────────────────────────────
    def _process_closed_bar_for_symbol(self, broker_sym: str, sym_state: Dict[str, Any], closed_rates, current_bar, config_sym: Optional[str] = None):
        if config_sym is None:
            config_sym = broker_sym
        n = len(closed_rates)
        if n < 20:
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

        if self.strategy == "HAIDER_ENHANCED":
            lower_wick = (min(o, c) - l) / crange
            upper_wick = (h - max(o, c)) / crange

            is_buy = (c < o) and (cbody > curr_atr * self.impulse_mult) and (curr_rsi < self.rsi_buy_level) and (lower_wick >= self.min_wick_ratio)
            is_sell = (c > o) and (cbody > curr_atr * self.impulse_mult) and (curr_rsi > self.rsi_sell_level) and (upper_wick >= self.min_wick_ratio)
            sl_buffer_mult = self.sl_buffer  # 1.35x ATR
        else:
            # Baseline REAL_DIP
            is_buy = (c < o) and (cbody > curr_atr * self.impulse_mult) and (curr_rsi < self.rsi_buy_level)
            is_sell = (c > o) and (cbody > curr_atr * self.impulse_mult) and (curr_rsi > self.rsi_sell_level)
            sl_buffer_mult = 1.0

        strat_name = "Haider-Scalper-Enhanced" if self.strategy == "HAIDER_ENHANCED" else "Haider-Gold-Scalper"

        if is_sell:
            entry = float(current_bar["open"])
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
                "strategy": self.strategy,
                "sl": sl,
                "tp1": tp1
            }
            print(f"[SCALPER_BOT] >>> SELL Signal on {broker_sym} @ {entry:.3f}! Executing trade immediately (< 3s)...", flush=True)
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
                "strategy": self.strategy,
                "sl": sl,
                "tp1": tp1
            }
            print(f"[SCALPER_BOT] >>> BUY Signal on {broker_sym} @ {entry:.3f}! Executing trade immediately (< 3s)...", flush=True)
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
    def _execute_signal(self, symbol: str, signal_type: str, entry: float, sl: float, tp1: float, strategy_name: str):
        # Strict user risk constraint: Gold lot size <= 1.0
        is_gold = "XAU" in symbol.upper() or "GOLD" in symbol.upper()
        raw_lot = self.lot_size
        total_lot = min(self.max_gold_lot, raw_lot) if is_gold else raw_lot
        total_lot = max(0.01, round(total_lot, 2))

        direction = 1 if signal_type == "BUY" else -1
        t_dist = abs(tp1 - entry)
        tp2 = (entry + t_dist * 2.2) if direction == 1 else max(0.001, entry - t_dist * 2.2)

        # Tranche volume calculation
        if total_lot >= 0.02 and self.strategy == "HAIDER_ENHANCED":
            tranche_1_vol = round(total_lot * 0.5, 2)
            tranche_2_vol = round(total_lot - tranche_1_vol, 2)
            orders_to_place = [
                {"vol": tranche_1_vol, "tp": tp1, "comment": f"{strategy_name} [TP1]", "is_runner": False},
                {"vol": tranche_2_vol, "tp": tp2, "comment": f"{strategy_name} [Runner]", "is_runner": True, "auto_be_target": tp1}
            ]
        else:
            orders_to_place = [
                {"vol": total_lot, "tp": tp1, "comment": strategy_name, "is_runner": False}
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
                    "be_done": False,
                    "opened_at": int(time.time()),
                    "comment": plan["comment"]
                }
                self.active_bot_orders[ticket] = trade_info
                executed_orders.append(trade_info)

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
            summary_msg = f"⚡ Autonomous MT5 Execution: Opened {len(executed_orders)} Tranche(s) for {signal_type} {symbol} (Total {total_lot} Lots, SL: {sl:.3f}, TP1: {tp1:.3f})"
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
                    "comment": comment[:31],
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
                if not self.active_bot_orders or not MT5_AVAILABLE:
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

                    for ticket, trade in list(self.active_bot_orders.items()):
                        if trade.get("be_done") or not trade.get("auto_be_target"):
                            continue

                        pos = open_tickets.get(ticket)
                        if not pos:
                            continue

                        target_tp1 = trade["auto_be_target"]
                        entry_px = float(pos.price_open)
                        curr_sl = float(pos.sl)
                        is_buy = (pos.type == 0)

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
    return scalper_bot
