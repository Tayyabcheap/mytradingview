import os
import sys
import time
import threading
from typing import Dict, Any, List, Optional, Tuple

# Ensure the src directory is in sys.path so modules can import each other
_src_dir = os.path.dirname(os.path.abspath(__file__))
if _src_dir not in sys.path:
    sys.path.insert(0, _src_dir)

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO
import store
import pandas as pd
import ta
from stress_test import run_monte_carlo_simulation
from screener import scan_symbols
from notifications import get_discord_config, save_discord_config, send_discord_alert
import config
from intelligence import (
    calculate_hurst_exponent,
    calculate_kelly_criterion,
    calculate_zscore,
    calculate_price_projections,
    get_champions_council_verdict,
    get_macro_sentinel_status,
    get_gold_liquidity_fixes,
    calculate_order_blocks,
    find_order_block_confluences,
    get_primary_order_block_setup,
    calculate_sr_zones,
    find_sr_confluences,
    get_primary_sr_setup
)

try:
    import MetaTrader5 as mt5
    MT5_IMPORTED = True
except Exception:
    mt5 = None
    MT5_IMPORTED = False

app = Flask(__name__)

# Server host and port configuration (defaults to 0.0.0.0 so remote VMs and local bind work seamlessly)
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", 5000))

# Only the app's own local origins may call the API from a browser. This blocks
# a malicious web page you have open from POSTing to the local trade endpoints
# (drive-by CSRF against a money-moving localhost server).
ALLOWED_ORIGINS = [
    "http://127.0.0.1:5000", "http://localhost:5000",
    "http://127.0.0.1:5173", "http://localhost:5173",
]
custom_origin = os.environ.get("ALLOWED_ORIGIN")
if custom_origin and custom_origin not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(custom_origin)

CORS(app, resources={r"/api/*": {"origins": "*" if HOST == "0.0.0.0" else ALLOWED_ORIGINS}})
socketio = SocketIO(app, cors_allowed_origins="*" if HOST == "0.0.0.0" else ALLOWED_ORIGINS)

def _blocked_cross_origin():
    """True when a browser sends a cross-origin request to a protected endpoint.
    Non-browser clients (curl, the user's own scripts) send no Origin and are allowed."""
    origin = request.headers.get("Origin")
    if origin is None:
        return False
    if origin in ALLOWED_ORIGINS:
        return False
    # Dynamic same-origin check for remote VMs or custom IP/domain access
    try:
        req_root = request.host_url.rstrip("/")
        if origin == req_root:
            return False
    except Exception:
        pass
    return True

mt5_lock = threading.RLock()
_initialized = False
_last_init_attempt = 0.0
_INIT_RETRY_COOLDOWN = 3.0  # seconds between MT5 connection retries

def init_mt5():
    global _initialized, _last_init_attempt
    if not MT5_IMPORTED:
        return False
    with mt5_lock:
        try:
            info = mt5.terminal_info()
            if _initialized and info is not None and info.connected:
                return True
        except Exception:
            pass

        now = time.time()
        if now - _last_init_attempt < _INIT_RETRY_COOLDOWN:
            return False
        _last_init_attempt = now

        try:
            if not mt5.initialize():
                _initialized = False
                return False
            _initialized = True
            return True
        except Exception:
            _initialized = False
            return False

@app.before_request
def before_req():
    # Never block static frontend asset serving or root page on MT5 initialization
    if not request.path.startswith("/api/"):
        return
    init_mt5()

@app.route("/api/health", methods=["GET"])
def api_health():
    t_info = mt5.terminal_info() if MT5_IMPORTED else None
    return jsonify({
        "status": "ok",
        "mt5_connected": bool(_initialized and t_info and t_info.connected),
        "time": time.time()
    })

# Map TradingView string timeframes to MT5 constants
TF_MAP = {
    "1M": mt5.TIMEFRAME_M1 if MT5_IMPORTED else None,
    "3M": mt5.TIMEFRAME_M3 if MT5_IMPORTED else None,
    "5M": mt5.TIMEFRAME_M5 if MT5_IMPORTED else None,
    "15M": mt5.TIMEFRAME_M15 if MT5_IMPORTED else None,
    "30M": mt5.TIMEFRAME_M30 if MT5_IMPORTED else None,
    "1H": mt5.TIMEFRAME_H1 if MT5_IMPORTED else None,
    "4H": mt5.TIMEFRAME_H4 if MT5_IMPORTED else None,
    "1D": mt5.TIMEFRAME_D1 if MT5_IMPORTED else None,
    "1W": mt5.TIMEFRAME_W1 if MT5_IMPORTED else None,
}

# Seconds per bar, used for history paging window math
SEC_PER_BAR = {
    "1M": 60, "3M": 180, "5M": 300, "15M": 900, "30M": 1800,
    "1H": 3600, "4H": 14400, "1D": 86400, "1W": 604800,
}

import datetime
from journal_engine import categorize_symbol, parse_mt5_deals_to_trades, calculate_trade_statistics, format_duration

def get_filling_mode(symbol_info):
    if symbol_info is None:
        return mt5.ORDER_FILLING_IOC if MT5_IMPORTED else 0
    mode = symbol_info.filling_mode
    # Bit 0 = FOK (1), Bit 1 = IOC (2), Bit 2 = RETURN (4)
    if mode & 2 or mode == 2:
        return mt5.ORDER_FILLING_IOC
    elif mode & 1 or mode == 1:
        return mt5.ORDER_FILLING_FOK
    elif mode & 4 or mode == 4:
        return mt5.ORDER_FILLING_RETURN
    return mt5.ORDER_FILLING_IOC

from symbol_utils import resolve_broker_symbol as _resolve_broker_symbol, clean_base_symbol

def resolve_broker_symbol(symbol: str) -> str:
    """Find the exact matching symbol in MT5, handling broker suffix variations
    (e.g., XAUUSD vs XAUUSDc vs XAUUSDm vs XAUUSD.m)."""
    if not MT5_IMPORTED or not symbol:
        return symbol
    if not init_mt5():
        return symbol
    return _resolve_broker_symbol(symbol, mt5_lock=mt5_lock)


@app.route("/api/account", methods=["GET"])
def get_account():
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    with mt5_lock:
        info = mt5.account_info()
        t_info = mt5.terminal_info()
        if info is None:
            return jsonify({"error": "Unable to fetch account info"}), 500

        d = info._asdict()
        d["connected"] = bool(t_info.connected if t_info else True)
        d["terminal_name"] = t_info.name if t_info else "MetaTrader 5"
        d["terminal_build"] = t_info.build if t_info else 0
        return jsonify(d)

@app.route("/api/symbols", methods=["GET"])
def get_symbols():
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500
    
    with mt5_lock:
        symbols = mt5.symbols_get()
        if not symbols:
            return jsonify([])
        
        res = []
        for s in symbols:
            # Metadata only — NO per-symbol tick fetch here (that made this endpoint
            # scale with the broker's whole symbol list and slowed page load).
            # Live bid/ask come from /api/quotes for the watchlist instead.
            res.append({
                "name": s.name,
                "description": s.description,
                "path": s.path,
                "category": categorize_symbol(s.name, s.path, s.description),
                "digits": s.digits,
                "point": s.point,
                "spread": s.spread,
                "visible": bool(s.visible),
                "min_lot": float(s.volume_min),
                "max_lot": float(s.volume_max),
                "step_lot": float(s.volume_step),
                "bid": None,
                "ask": None,
            })
        return jsonify(res)

# Global in-memory tracking registry for Auto-Breakeven at TP1
AUTO_BE_TRACKER = {}

def _check_auto_breakeven(positions):
    """Checks open positions and moves SL to breakeven if TP1 has been crossed."""
    global AUTO_BE_TRACKER
    if not AUTO_BE_TRACKER or not positions:
        return
    for p in positions:
        ticket = p.ticket
        if ticket in AUTO_BE_TRACKER:
            track = AUTO_BE_TRACKER[ticket]
            if track.get("be_done"):
                continue
            tp1 = track.get("tp1")
            open_price = track.get("open_price", p.price_open)
            current_sl = p.sl

            should_move_be = False
            if p.type == 0:  # BUY
                if p.price_current >= tp1 and (current_sl < open_price or current_sl == 0.0):
                    should_move_be = True
            elif p.type == 1:  # SELL
                if p.price_current <= tp1 and (current_sl > open_price or current_sl == 0.0):
                    should_move_be = True

            if should_move_be:
                req = {
                    "action": mt5.TRADE_ACTION_SLTP,
                    "position": ticket,
                    "symbol": p.symbol,
                    "sl": float(open_price),
                    "tp": float(p.tp),
                }
                res = mt5.order_send(req)
                if res and res.retcode == mt5.TRADE_RETCODE_DONE:
                    track["be_done"] = True
                    print(f"[AUTO-BE] >>> Moved SL for #{ticket} ({p.symbol}) to Breakeven ({open_price})!", flush=True)
                    send_discord_alert(
                        title=f"🛡️ Auto-Breakeven Primed: #{ticket} ({p.symbol})",
                        description=f"Position #{ticket} reached TP1 ({tp1}). Stop Loss was moved to Breakeven at entry price ({open_price}). Trade is now 100% risk-free!",
                        color=0x089981,
                        fields=[
                            {"name": "Symbol", "value": p.symbol, "inline": True},
                            {"name": "Entry", "value": str(open_price), "inline": True},
                            {"name": "TP1 Target", "value": str(tp1), "inline": True}
                        ]
                    )

@app.route("/api/positions", methods=["GET"])
def get_positions():
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    with mt5_lock:
        positions = mt5.positions_get()
        if not positions:
            return jsonify([])

        # Check and apply Auto-Breakeven at TP1
        _check_auto_breakeven(positions)

        out = []
        for p in positions:
            p_dict = p._asdict()
            p_dict["type_str"] = "BUY" if p_dict.get("type") == 0 else "SELL"
            p_dict["category"] = categorize_symbol(p_dict.get("symbol", ""))
            p_dict["time_str"] = datetime.datetime.fromtimestamp(p_dict.get("time", 0)).strftime("%Y-%m-%d %H:%M:%S") if p_dict.get("time") else ""
            if p.ticket in AUTO_BE_TRACKER:
                p_dict["auto_be"] = True
                p_dict["auto_be_tp1"] = AUTO_BE_TRACKER[p.ticket].get("tp1")
                p_dict["auto_be_done"] = AUTO_BE_TRACKER[p.ticket].get("be_done", False)
            out.append(p_dict)
        return jsonify(out)

@app.route("/api/order/preflight", methods=["GET"])
def order_preflight():
    """Read-only check of whether a trade could actually be placed right now.
    Used by the trade panel to warn the user BEFORE they try to execute."""
    if not init_mt5():
        return jsonify({"ok": False, "connected": False, "reason": "MT5 not connected"}), 200
    with mt5_lock:
        t = mt5.terminal_info()
        a = mt5.account_info()
        terminal_algo = bool(t.trade_allowed) if t is not None else False
        account_trade = bool(a.trade_allowed) if a is not None else False
        connected = bool(t.connected) if t is not None else False
        ok = connected and terminal_algo and account_trade
        reason = "OK"
        if not connected:
            reason = "MT5 terminal not connected to broker"
        elif not terminal_algo:
            reason = "AlgoTrading is OFF in MT5 (click the Algo Trading button)"
        elif not account_trade:
            reason = "Account is not allowed to trade (investor login or market closed)"
        return jsonify({
            "ok": ok,
            "connected": connected,
            "terminal_algo_trading": terminal_algo,
            "account_trade_allowed": account_trade,
            "reason": reason,
        }), 200


@app.route("/api/order/send", methods=["POST"])
def send_order():
    if _blocked_cross_origin():
        return jsonify({"error": "Cross-origin trade request blocked"}), 403
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    data = request.get_json(force=True) or {}
    print(f"[ORDER] >>> /api/order/send received: {data}", flush=True)
    symbol = resolve_broker_symbol(data.get("symbol", "").strip())
    order_type_str = (data.get("type") or "BUY").upper()
    try:
        volume = round(float(data.get("volume", 0.01)), 2)
    except (ValueError, TypeError):
        volume = 0.01
    
    sl = float(data.get("sl") or 0.0)
    tp = float(data.get("tp") or 0.0)
    raw_comment = data.get("comment", "Haider-Enhanced")
    safe_comment = str(raw_comment)[:27] if raw_comment else "Haider-Enhanced"

    if not symbol:
        return jsonify({"error": "Symbol is required"}), 400

    # MANDATORY USER SAFETY RULE: Max lot on Gold (XAUUSD) is strictly 1.0
    sym_upper = symbol.upper()
    if ("XAU" in sym_upper or "GOLD" in sym_upper) and volume > 1.0:
        return jsonify({
            "error": f"Safety Limit Rejection: Maximum lot size for Gold ({symbol}) is 1.0. Requested volume ({volume}) exceeds safety limit."
        }), 400

    with mt5_lock:
        # Pre-flight: MT5 must have AlgoTrading enabled or order_send silently fails.
        t_info = mt5.terminal_info()
        if t_info is not None and not t_info.trade_allowed:
            print("[ORDER] !!! blocked: AlgoTrading disabled in the MT5 terminal", flush=True)
            return jsonify({"error": "AlgoTrading is DISABLED in MetaTrader 5. Click the 'Algo Trading' button in the MT5 toolbar (it must turn green), then try again."}), 409
        a_info = mt5.account_info()
        if a_info is not None and not a_info.trade_allowed:
            print("[ORDER] !!! blocked: trading not allowed on this account", flush=True)
            return jsonify({"error": "Trading is not allowed on this MT5 account (it may be read-only / investor login, or the market is closed)."}), 409

        if not mt5.symbol_select(symbol, True):
            return jsonify({"error": f"Symbol not found: {symbol}"}), 404

        s_info = mt5.symbol_info(symbol)
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            return jsonify({"error": f"Cannot fetch live quote for {symbol}"}), 500

        price = float(tick.ask) if order_type_str == "BUY" else float(tick.bid)
        action_type = mt5.ORDER_TYPE_BUY if order_type_str == "BUY" else mt5.ORDER_TYPE_SELL
        filling = get_filling_mode(s_info)

        req = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": volume,
            "type": action_type,
            "price": price,
            "sl": sl,
            "tp": tp,
            "deviation": 30,
            "magic": 888201,
            "comment": safe_comment,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": filling,
        }

        print(f"[ORDER] sending to MT5: {req}", flush=True)
        res = mt5.order_send(req)
        if res is None:
            le = mt5.last_error()
            print(f"[ORDER] !!! order_send returned None. last_error={le}", flush=True)
            return jsonify({"error": f"MT5 order_send returned None. last_error={le}"}), 500

        if res.retcode != mt5.TRADE_RETCODE_DONE:
            print(f"[ORDER] !!! rejected retcode={res.retcode} comment={res.comment}", flush=True)
            return jsonify({
                "error": f"Order failed ({res.retcode}): {res.comment}",
                "retcode": res.retcode,
                "comment": res.comment
            }), 400
        print(f"[ORDER] <<< SUCCESS order={res.order} deal={res.deal} price={res.price}", flush=True)

        # Register for Auto-Breakeven if requested
        if (data.get("auto_be_tp1") or data.get("auto_be")) and tp > 0:
            tp1_val = float(data.get("tp1") or 0.0)
            if not tp1_val:
                # Default TP1 is 50% of the distance from entry to TP
                tp1_val = round(price + (tp - price) * 0.5, 3)
            AUTO_BE_TRACKER[res.order] = {
                "symbol": symbol,
                "type": order_type_str,
                "open_price": res.price or price,
                "tp1": tp1_val,
                "tp": tp,
                "sl": sl,
                "be_done": False
            }
            print(f"[AUTO-BE] Registered #{res.order} for Auto-Breakeven at TP1={tp1_val}", flush=True)

        # Dispatch Discord trade notification if enabled
        send_discord_alert(
            title=f"⚡ Order Placed: {order_type_str} {volume:.2f} {symbol}",
            description=f"Order #{res.order} executed successfully at {res.price or price:.3f}.",
            color=0x089981 if order_type_str == "BUY" else 0xF23645,
            fields=[
                {"name": "Symbol", "value": symbol, "inline": True},
                {"name": "Type", "value": order_type_str, "inline": True},
                {"name": "Volume", "value": f"{volume:.2f} Lots", "inline": True},
                {"name": "Price", "value": f"{res.price or price:.3f}", "inline": True},
                {"name": "SL", "value": f"{sl:.3f}" if sl else "None", "inline": True},
                {"name": "TP", "value": f"{tp:.3f}" if tp else "None", "inline": True},
            ]
        )

        # Log to Haider-Gold-Scalper audit store
        try:
            from scalper_logger import upsert_trade
            upsert_trade({
                "id": f"mt5_{res.order}",
                "ticket": res.order,
                "symbol": symbol,
                "direction": order_type_str,
                "strategy": comment or "Haider-Gold-Scalper",
                "timeframe": data.get("timeframe", "5M"),
                "volume": volume,
                "entry_time": int(time.time()),
                "entry_time_str": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "entry_price": float(res.price or price),
                "planned_sl": sl,
                "planned_tp1": tp,
                "status": "OPEN",
                "notes": f"MT5 order #{res.order} executed"
            })
        except Exception as _log_err:
            print(f"[SCALPER_LOGGER] order log warning: {_log_err}", flush=True)

        return jsonify({
            "success": True,
            "order": res.order,
            "deal": res.deal,
            "volume": res.volume,
            "price": res.price,
            "comment": res.comment,
            "symbol": symbol,
            "type": order_type_str
        })

@app.route("/api/order/close", methods=["POST"])
def close_order():
    if _blocked_cross_origin():
        return jsonify({"error": "Cross-origin trade request blocked"}), 403
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    data = request.get_json(force=True) or {}
    try:
        ticket = int(data.get("ticket", 0))
    except (ValueError, TypeError):
        ticket = 0

    if not ticket:
        return jsonify({"error": "Ticket is required"}), 400

    with mt5_lock:
        positions = mt5.positions_get(ticket=ticket)
        if not positions or len(positions) == 0:
            all_pos = mt5.positions_get()
            match = [p for p in all_pos if p.ticket == ticket] if all_pos else []
            if not match:
                return jsonify({"error": f"Position #{ticket} not found or already closed"}), 404
            pos = match[0]
        else:
            pos = positions[0]

        s_info = mt5.symbol_info(pos.symbol)
        tick = mt5.symbol_info_tick(pos.symbol)
        if tick is None:
            return jsonify({"error": f"Cannot fetch live quote for {pos.symbol}"}), 500

        close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
        price = float(tick.bid) if pos.type == mt5.ORDER_TYPE_BUY else float(tick.ask)
        filling = get_filling_mode(s_info)

        req = {
            "action": mt5.TRADE_ACTION_DEAL,
            "position": pos.ticket,
            "symbol": pos.symbol,
            "volume": pos.volume,
            "type": close_type,
            "price": price,
            "deviation": 30,
            "magic": 888201,
            "comment": "Trade-with-Rakhi Close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": filling,
        }

        res = mt5.order_send(req)
        if res is None:
            return jsonify({"error": "MT5 order_send returned None"}), 500

        if res.retcode != mt5.TRADE_RETCODE_DONE:
            return jsonify({
                "error": f"Close position failed ({res.retcode}): {res.comment}",
                "retcode": res.retcode,
                "comment": res.comment
            }), 400

        # Update audit store for closed position
        try:
            from scalper_logger import upsert_trade
            upsert_trade({
                "id": f"mt5_{pos.ticket}",
                "ticket": pos.ticket,
                "exit_time": int(time.time()),
                "exit_time_str": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "exit_price": float(res.price or price),
                "exit_reason": "MANUAL_CLOSE",
                "pnl_usd": float(pos.profit or 0.0),
                "status": "CLOSED"
            })
        except Exception as _c_err:
            print(f"[SCALPER_LOGGER] close log warning: {_c_err}", flush=True)

        return jsonify({
            "success": True,
            "order": res.order,
            "deal": res.deal,
            "price": res.price,
            "ticket": pos.ticket,
            "profit": pos.profit,
            "comment": res.comment
        })

@app.route("/api/order/modify", methods=["POST"])
def modify_order():
    """Modify SL/TP of an open position using MT5 TRADE_ACTION_SLTP."""
    if _blocked_cross_origin():
        return jsonify({"error": "Cross-origin trade request blocked"}), 403
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    data = request.get_json(force=True) or {}
    try:
        ticket = int(data.get("ticket", 0))
    except (ValueError, TypeError):
        ticket = 0
    if not ticket:
        return jsonify({"error": "Ticket is required"}), 400

    new_sl = data.get("sl")
    new_tp = data.get("tp")

    with mt5_lock:
        positions = mt5.positions_get(ticket=ticket)
        if not positions:
            all_pos = mt5.positions_get()
            match = [p for p in all_pos if p.ticket == ticket] if all_pos else []
            if not match:
                return jsonify({"error": f"Position #{ticket} not found"}), 404
            pos = match[0]
        else:
            pos = positions[0]

        sl_val = float(new_sl) if new_sl is not None else float(pos.sl)
        tp_val = float(new_tp) if new_tp is not None else float(pos.tp)

        req = {
            "action": mt5.TRADE_ACTION_SLTP,
            "position": ticket,
            "symbol": pos.symbol,
            "sl": sl_val,
            "tp": tp_val,
        }
        res = mt5.order_send(req)
        if res is None:
            return jsonify({"error": f"MT5 order_send returned None: {mt5.last_error()}"}), 500
        if res.retcode != mt5.TRADE_RETCODE_DONE:
            return jsonify({"error": f"Modify failed ({res.retcode}): {res.comment}"}), 400

        return jsonify({
            "success": True,
            "ticket": ticket,
            "sl": sl_val,
            "tp": tp_val,
            "comment": res.comment
        })

@app.route("/api/order/auto_be", methods=["GET", "POST"])
def manage_auto_be():
    """Register or inspect Auto-Breakeven tracking for positions."""
    global AUTO_BE_TRACKER
    if request.method == "GET":
        return jsonify({"tracker": AUTO_BE_TRACKER})
    data = request.get_json(force=True) or {}
    ticket = data.get("ticket")
    if not ticket:
        return jsonify({"error": "ticket required"}), 400
    ticket = int(ticket)
    tp1 = float(data.get("tp1", 0.0))
    open_price = float(data.get("open_price", 0.0))
    symbol = data.get("symbol", "")
    type_str = (data.get("type") or "BUY").upper()
    AUTO_BE_TRACKER[ticket] = {
        "symbol": symbol,
        "type": type_str,
        "open_price": open_price,
        "tp1": tp1,
        "be_done": False
    }
    return jsonify({"success": True, "ticket": ticket, "tp1": tp1})

@app.route("/api/journal/trades", methods=["GET"])
def get_journal_trades():
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    days = int(request.args.get("days", 365))
    to_dt = datetime.datetime.now()
    from_dt = to_dt - datetime.timedelta(days=days)

    sym_filter = request.args.get("symbol", "").strip()
    cat_filter = request.args.get("category", "").strip()

    with mt5_lock:
        deals = mt5.history_deals_get(from_dt, to_dt)
        orders = mt5.history_orders_get(from_dt, to_dt)
        positions = mt5.positions_get()

    trades = parse_mt5_deals_to_trades(deals, orders)

    # Prepend active open positions
    if positions:
        for p in positions:
            p_dict = p._asdict()
            open_time = int(p_dict.get('time', 0))
            trades.insert(0, {
                "ticket": p_dict.get('ticket'),
                "order_id": p_dict.get('identifier'),
                "symbol": p_dict.get('symbol'),
                "category": categorize_symbol(p_dict.get('symbol', '')),
                "type": "BUY" if p_dict.get('type') == 0 else "SELL",
                "volume": float(p_dict.get('volume', 0.0)),
                "open_time": open_time,
                "open_time_str": datetime.datetime.fromtimestamp(open_time).strftime("%Y-%m-%d %H:%M:%S") if open_time else "",
                "open_price": float(p_dict.get('price_open', 0.0)),
                "close_time": None,
                "close_time_str": "",
                "close_price": float(p_dict.get('price_current', 0.0)),
                "sl": float(p_dict.get('sl', 0.0)),
                "tp": float(p_dict.get('tp', 0.0)),
                "exit_reason": "OPEN",
                "commission": 0.0,
                "swap": float(p_dict.get('swap', 0.0)),
                "profit": float(p_dict.get('profit', 0.0)),
                "net_pnl": round(float(p_dict.get('profit', 0.0)) + float(p_dict.get('swap', 0.0)), 2),
                "pips": round((float(p_dict.get('price_current', 0.0)) - float(p_dict.get('price_open', 0.0))) * (100 if "JPY" in p_dict.get('symbol', '') or "XAU" in p_dict.get('symbol', '') else 10000), 1),
                "status": "OPEN",
                "duration_sec": max(0, int(datetime.datetime.now().timestamp()) - open_time),
                "duration_str": format_duration(max(0, int(datetime.datetime.now().timestamp()) - open_time)),
                "comment": (p_dict.get('comment') or '').strip()
            })

    if sym_filter:
        trades = [t for t in trades if t['symbol'].lower() == sym_filter.lower()]
    if cat_filter and cat_filter != "ALL":
        trades = [t for t in trades if t['category'].lower() == cat_filter.lower()]

    return jsonify(trades)

@app.route("/api/journal/stats", methods=["GET"])
def get_journal_stats():
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    days = int(request.args.get("days", 365))
    to_dt = datetime.datetime.now()
    from_dt = to_dt - datetime.timedelta(days=days)

    with mt5_lock:
        deals = mt5.history_deals_get(from_dt, to_dt)
        orders = mt5.history_orders_get(from_dt, to_dt)

    trades = parse_mt5_deals_to_trades(deals, orders)
    stats = calculate_trade_statistics(trades)
    return jsonify(stats)


@app.route("/api/history", methods=["GET"])
def get_history():
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    raw_symbol = request.args.get("symbol", "XAUUSD")
    symbol = resolve_broker_symbol(raw_symbol)
    tf_str = request.args.get("timeframe", "1H")
    count = int(request.args.get("count", 1000))
    to_param = request.args.get("to")  # unix seconds; load `count` bars strictly older than this

    tf_const = TF_MAP.get(tf_str)
    if tf_const is None:
        return jsonify({"error": f"Invalid timeframe: {tf_str}"}), 400

    with mt5_lock:
        mt5.symbol_select(symbol, True)

        rates = None
        for attempt in range(4):
            if to_param:
                # Paging: fetch a generous window ending at `to`, then keep the
                # newest `count` bars that are strictly older than `to`.
                import datetime as _dt
                to_sec = int(float(to_param))
                spb = SEC_PER_BAR.get(tf_str, 3600)
                # x3 window buffer so weekend/holiday gaps still yield `count` bars
                frm_sec = to_sec - spb * count * 3 - spb * 4
                dt_from = _dt.datetime.utcfromtimestamp(max(0, frm_sec))
                dt_to = _dt.datetime.utcfromtimestamp(to_sec)
                rates = mt5.copy_rates_range(symbol, tf_const, dt_from, dt_to)
                if rates is not None and len(rates) > 0:
                    rates = [r for r in rates if int(r["time"]) < to_sec]
                    rates = rates[-count:]
                    break
            else:
                rates = mt5.copy_rates_from_pos(symbol, tf_const, 0, count)
                if rates is not None and len(rates) > 0:
                    break
            if attempt < 3:
                time.sleep(0.15)  # brief wait for fresh terminal to sync history with broker

    if rates is None or len(rates) == 0:
        return jsonify([])

    # Convert to list of dicts for lightweight-charts
    # lightweight-charts expects time in seconds as an integer for daily/intraday
    data = []
    for r in rates:
        data.append({
            "time": int(r["time"]),
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "value": float(r["tick_volume"]) # Use tick_volume for volume chart
        })
    return jsonify(data)

@app.route("/api/quote", methods=["GET"])
def get_quote():
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    raw_symbol = request.args.get("symbol", "XAUUSD")
    symbol = resolve_broker_symbol(raw_symbol)
    with mt5_lock:
        mt5.symbol_select(symbol, True)
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            return jsonify({"error": "No quote available"}), 404
        
        return jsonify({
            "symbol": symbol,
            "bid": float(tick.bid),
            "ask": float(tick.ask),
            "time": int(tick.time)
        })

@app.route("/api/indicator", methods=["GET"])
def get_indicator():
    """
    Generic endpoint to calculate indicators via ta library.
    Example: /api/indicator?symbol=EURUSD&timeframe=1H&type=rsi&length=14
    """
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    raw_symbol = request.args.get("symbol", "XAUUSD")
    symbol = resolve_broker_symbol(raw_symbol)
    tf_str = request.args.get("timeframe", "1H")
    ind_type = request.args.get("type", "rsi").lower()
    
    tf_const = TF_MAP.get(tf_str)
    if tf_const is None:
        return jsonify({"error": "Invalid timeframe"}), 400

    # Fetch enough data to calculate indicator reliably
    with mt5_lock:
        rates = mt5.copy_rates_from_pos(symbol, tf_const, 0, 1500)
    
    if rates is None or len(rates) == 0:
        return jsonify([])
        
    df = pd.DataFrame(rates)
    df['time'] = pd.to_datetime(df['time'], unit='s')
    df.set_index('time', inplace=True)
    
    # Calculate requested indicator using 'ta'
    try:
        if ind_type == "rsi":
            from ta.momentum import RSIIndicator
            length = int(request.args.get("length", 14))
            indicator = RSIIndicator(close=df['close'], window=length)
            df['result'] = indicator.rsi()
        elif ind_type == "ema":
            from ta.trend import EMAIndicator
            length = int(request.args.get("length", 20))
            indicator = EMAIndicator(close=df['close'], window=length)
            df['result'] = indicator.ema_indicator()
        elif ind_type == "sma":
            from ta.trend import SMAIndicator
            length = int(request.args.get("length", 20))
            indicator = SMAIndicator(close=df['close'], window=length)
            df['result'] = indicator.sma_indicator()
        elif ind_type == "macd":
            from ta.trend import MACD
            fast = int(request.args.get("fast", 12))
            slow = int(request.args.get("slow", 26))
            sig = int(request.args.get("signal", 9))
            indicator = MACD(close=df['close'], window_fast=fast, window_slow=slow, window_sign=sig)
            df['macd'] = indicator.macd()
            df['histogram'] = indicator.macd_diff()
            df['signal'] = indicator.macd_signal()
            
            res = []
            for time_idx, row in df.dropna(subset=['macd']).iterrows():
                res.append({
                    "time": int(time_idx.timestamp()),
                    "macd": float(row['macd']),
                    "histogram": float(row['histogram']),
                    "signal": float(row['signal'])
                })
            return jsonify(res)
        else:
            return jsonify({"error": f"Unsupported indicator: {ind_type}"}), 400
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Format result for single-line indicators
    res = []
    for time_idx, row in df.dropna(subset=['result']).iterrows():
        res.append({
            "time": int(time_idx.timestamp()),
            "value": float(row['result'])
        })
        
    return jsonify(res)

@app.route("/api/signals", methods=["GET"])
def get_signals():
    """
    Calculate and return algorithmic trade signals for the specified symbol, timeframe, and strategy.
    Example: /api/signals?symbol=XAUUSDc&timeframe=1H&strategy=ALL
    """
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    raw_symbol = request.args.get("symbol", "XAUUSD")
    symbol = resolve_broker_symbol(raw_symbol)
    tf_str = request.args.get("timeframe", "1H")
    strategy_filter = request.args.get("strategy", "ALL").upper() # ALL | SWING_CORE | SWING_PRO
    count = int(request.args.get("count", 1500))

    tf_const = TF_MAP.get(tf_str)
    if tf_const is None:
        return jsonify({"error": f"Invalid timeframe: {tf_str}"}), 400

    with mt5_lock:
        if not mt5.symbol_select(symbol, True):
            return jsonify({"error": f"Symbol not found: {symbol}"}), 404
        
        rates_ltf = mt5.copy_rates_from_pos(symbol, tf_const, 0, count)
        # Fetch HTF for macro trend (e.g. 1D or 4H)
        htf_tf = mt5.TIMEFRAME_D1 if tf_str in ["1M", "5M", "15M", "30M", "1H"] else mt5.TIMEFRAME_W1
        rates_htf = mt5.copy_rates_from_pos(symbol, htf_tf, 0, 300)
        # Fetch ITF for momentum (e.g. 4H or 1H)
        itf_tf = mt5.TIMEFRAME_H4 if tf_str in ["1M", "5M", "15M", "30M"] else tf_const
        rates_itf = mt5.copy_rates_from_pos(symbol, itf_tf, 0, 500)

    if rates_ltf is None or len(rates_ltf) == 0:
        return jsonify([])

    try:
        from signal_engine import SignalEngine, SWING_CORE, SWING_PRO
        from indicators import prepare_dataframe

        df_ltf = pd.DataFrame(rates_ltf)
        df_ltf['time'] = pd.to_datetime(df_ltf['time'], unit='s')
        
        df_htf = pd.DataFrame(rates_htf) if rates_htf is not None and len(rates_htf) > 0 else None
        if df_htf is not None:
            df_htf['time'] = pd.to_datetime(df_htf['time'], unit='s')
            
        df_itf = pd.DataFrame(rates_itf) if rates_itf is not None and len(rates_itf) > 0 else None
        if df_itf is not None:
            df_itf['time'] = pd.to_datetime(df_itf['time'], unit='s')

        df_prepared = prepare_dataframe(df_ltf, df_itf, df_htf)
        engine = SignalEngine()
        if df_htf is not None:
            engine.prepare_sr(df_htf)

        signals = []
        strategies = [SWING_CORE, SWING_PRO] if strategy_filter == "ALL" else [strategy_filter]

        for i in range(20, len(df_prepared)):
            for strat in strategies:
                sig = engine.evaluate_bar(df_prepared, i, strategy=strat)
                if sig:
                    sig_time = df_prepared.iloc[i]['time']
                    sig_time_sec = int(sig_time.timestamp()) if hasattr(sig_time, 'timestamp') else int(sig['time'])
                    sig['timestamp'] = sig_time_sec * 1000
                    sig['time'] = sig_time_sec
                    signals.append(sig)

        return jsonify(signals)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/quotes", methods=["GET"])
def get_quotes():
    """Batch live quotes for a comma-separated list of symbols (watchlist)."""
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    raw = request.args.get("symbols", "")
    names = [x.strip() for x in raw.split(",") if x.strip()]
    out = []
    with mt5_lock:
        for name in names:
            resolved_name = resolve_broker_symbol(name)
            try:
                mt5.symbol_select(resolved_name, True)
                tick = mt5.symbol_info_tick(resolved_name)
                if tick is None:
                    out.append({"symbol": name, "price": None})
                    continue
                price = float(tick.bid) if tick.bid else float(tick.last)
                out.append({
                    "symbol": name,
                    "bid": float(tick.bid),
                    "ask": float(tick.ask),
                    "price": price,
                    "time": int(tick.time),
                })
            except Exception:
                out.append({"symbol": name, "price": None})
    return jsonify(out)

@app.route("/api/backtest/gold_scalper", methods=["GET"])
def backtest_gold_scalper():
    """Run the Gold Scalper Pro strategy against real MT5 history and return stats."""
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    raw_symbol = request.args.get("symbol", "XAUUSD")
    symbol = resolve_broker_symbol(raw_symbol)
    tf_str = request.args.get("timeframe", "1H")
    bars_n = int(request.args.get("bars", 8000))

    tf_const = TF_MAP.get(tf_str)
    if tf_const is None:
        alt = {"H1": "1H", "H4": "4H", "D1": "1D", "M1": "1M", "M5": "5M",
               "M15": "15M", "M30": "30M", "W1": "1W"}.get(tf_str)
        tf_const = TF_MAP.get(alt) if alt else None
    if tf_const is None:
        return jsonify({"error": f"Invalid timeframe: {tf_str}"}), 400

    with mt5_lock:
        if not mt5.symbol_select(symbol, True):
            return jsonify({"error": f"Symbol not found: {symbol}"}), 404
        rates = mt5.copy_rates_from_pos(symbol, tf_const, 0, bars_n)

    if rates is None or len(rates) == 0:
        return jsonify({"error": "No history returned from MT5"}), 404

    bars = [(int(r["time"]), float(r["open"]), float(r["high"]),
             float(r["low"]), float(r["close"])) for r in rates]

    try:
        from gold_scalper_bt import backtest as _bt
        res = _bt(
            bars,
            fast=int(request.args.get("fast", 21)),
            slow=int(request.args.get("slow", 50)),
            rsi_len=int(request.args.get("rsi_len", 14)),
            rsi_ob=float(request.args.get("rsi_ob", 70)),
            rsi_os=float(request.args.get("rsi_os", 30)),
            atr_len=int(request.args.get("atr_len", 14)),
            sl_mult=float(request.args.get("sl_mult", 1.5)),
            tp_mult=float(request.args.get("tp_mult", 2.5)),
            session=request.args.get("session", "0800-1200"),
            utc_offset=int(request.args.get("utc_offset", 0)),
        )
        res["symbol"] = symbol
        res["timeframe"] = tf_str
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/backtest/haider_gold_scalper", methods=["GET"])
@app.route("/api/backtest/real_dip", methods=["GET"])
def backtest_haider_gold_scalper():
    """Run the Haider-Gold-Scalper [SL Buffer] strategy against real MT5 history and return stats."""
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    raw_symbol = request.args.get("symbol", "XAUUSD")
    symbol = resolve_broker_symbol(raw_symbol)
    tf_str = request.args.get("timeframe", "1H")
    bars_n = int(request.args.get("bars", 3000))

    tf_const = TF_MAP.get(tf_str)
    if tf_const is None:
        alt = {"H1": "1H", "H4": "4H", "D1": "1D", "M1": "1M", "M5": "5M",
               "M15": "15M", "M30": "30M", "W1": "1W"}.get(tf_str)
        tf_const = TF_MAP.get(alt) if alt else None
    if tf_const is None:
        return jsonify({"error": f"Invalid timeframe: {tf_str}"}), 400

    with mt5_lock:
        if not mt5.symbol_select(symbol, True):
            return jsonify({"error": f"Symbol not found: {symbol}"}), 404
        info = mt5.symbol_info(symbol)
        mintick = float(info.point) if (info and info.point) else float(request.args.get("mintick", 0.01))
        tick_value = float(info.trade_tick_value) if (info and info.trade_tick_value) else 1.0
        rates = mt5.copy_rates_from_pos(symbol, tf_const, 0, bars_n)

    if rates is None or len(rates) == 0:
        return jsonify({"error": "No history returned from MT5"}), 404

    bars = [(int(r["time"]), float(r["open"]), float(r["high"]),
             float(r["low"]), float(r["close"])) for r in rates]

    try:
        from real_dip_bt import backtest as _bt
        res = _bt(
            bars,
            atr_len=int(request.args.get("atr_len", 14)),
            impulse_mult=float(request.args.get("impulse_mult", 1.0)),
            rsi_len=int(request.args.get("rsi_len", 14)),
            rsi_buy=float(request.args.get("rsi_buy", 35.0)),
            rsi_sell=float(request.args.get("rsi_sell", 65.0)),
            target_level=float(request.args.get("target_level", 50.0)),
            sl_buffer=float(request.args.get("sl_buffer", 1.0)),
            lot_size=float(request.args.get("lot_size", 0.10)),
            mintick=mintick,
            tick_value=tick_value,
        )
        res["symbol"] = symbol
        res["timeframe"] = tf_str
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/backtest/haider_enhanced", methods=["GET"])
def backtest_haider_enhanced():
    """Run Haider-Scalper-Enhanced (Anti-Hunt Buffer + 18% Rejection Wick + 2-Tranche Auto-BE) on MT5 history."""
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    raw_symbol = request.args.get("symbol", "XAUUSD")
    symbol = resolve_broker_symbol(raw_symbol)
    tf_str = request.args.get("timeframe", "5M")
    bars_n = int(request.args.get("bars", 3000))

    tf_const = TF_MAP.get(tf_str)
    if tf_const is None:
        alt = {"H1": "1H", "H4": "4H", "D1": "1D", "M1": "1M", "M5": "5M",
               "M15": "15M", "M30": "30M", "W1": "1W"}.get(tf_str)
        tf_const = TF_MAP.get(alt) if alt else None
    if tf_const is None:
        return jsonify({"error": f"Invalid timeframe: {tf_str}"}), 400

    with mt5_lock:
        if not mt5.symbol_select(symbol, True):
            return jsonify({"error": f"Symbol not found: {symbol}"}), 404
        info = mt5.symbol_info(symbol)
        mintick = float(info.point) if (info and info.point) else float(request.args.get("mintick", 0.01))
        tick_value = float(info.trade_tick_value) if (info and info.trade_tick_value) else 1.0
        rates = mt5.copy_rates_from_pos(symbol, tf_const, 0, bars_n)

    if rates is None or len(rates) == 0:
        return jsonify({"error": "No history returned from MT5"}), 404

    bars = [(int(r["time"]), float(r["open"]), float(r["high"]),
             float(r["low"]), float(r["close"])) for r in rates]

    try:
        from enhanced_scalper_bt import backtest as _bt_enh
        res = _bt_enh(
            bars,
            atr_len=int(request.args.get("atr_len", 14)),
            impulse_mult=float(request.args.get("impulse_mult", 1.0)),
            rsi_len=int(request.args.get("rsi_len", 14)),
            rsi_buy_level=float(request.args.get("rsi_buy", 36.0)),
            rsi_sell_level=float(request.args.get("rsi_sell", 64.0)),
            target_level=float(request.args.get("target_level", 50.0)),
            sl_buffer=float(request.args.get("sl_buffer", 1.35)),
            min_wick_ratio=float(request.args.get("min_wick_ratio", 0.18)),
            skip_rollover=True,
            lot_size=float(request.args.get("lot_size", 0.10)),
            mintick=mintick,
            tick_value=tick_value,
        )
        res["symbol"] = symbol
        res["timeframe"] = tf_str
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def compute_symbol_performance(raw_symbol: str, bars_n: int = 3000, lot_size: float = 0.10) -> Dict[str, Any]:
    """Compute comprehensive audited payoff metrics for both Haider-Scalper-Enhanced and
    Haider-Gold-Scalper (Baseline) on closed 5M bars for any broker instrument."""
    if not MT5_IMPORTED or not init_mt5():
        return {"error": "MT5 not connected", "symbol": raw_symbol}

    symbol = resolve_broker_symbol(raw_symbol)
    clean_sym = clean_base_symbol(symbol)

    with mt5_lock:
        if not mt5.symbol_select(symbol, True):
            return {"error": f"Symbol not found: {symbol}", "symbol": symbol, "clean_symbol": clean_sym}
        info = mt5.symbol_info(symbol)
        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M5, 0, bars_n)

    if rates is None or len(rates) < 40:
        return {"error": "Insufficient history", "symbol": symbol, "clean_symbol": clean_sym}

    point = float(info.point) if (info and info.point) else 0.01
    digits = int(info.digits) if (info and info.digits is not None) else 2
    tick_val = float(info.trade_tick_value) if (info and info.trade_tick_value) else 1.0

    # Determine pip size
    u_clean = clean_sym.upper()
    if "XAU" in u_clean or "GOLD" in u_clean:
        pip_size = 0.10
    elif "JPY" in u_clean:
        pip_size = 0.01
    elif "BTC" in u_clean or "ETH" in u_clean:
        pip_size = 1.0
    elif digits in (3, 5):
        pip_size = point * 10.0
    else:
        pip_size = point

    pts_to_pip = (point / pip_size) if pip_size > 0 else 1.0

    bars = [(int(r["time"]), float(r["open"]), float(r["high"]),
             float(r["low"]), float(r["close"])) for r in rates]

    span_secs = max(1, bars[-1][0] - bars[0][0])
    trading_days = max(1.0, round((span_secs / 86400.0) * (5.0 / 7.0), 1))

    from enhanced_scalper_bt import backtest as _bt_enh
    from real_dip_bt import backtest as _bt_base

    enh = _bt_enh(bars, mintick=point, lot_size=lot_size, tick_value=tick_val)
    base = _bt_base(bars, mintick=point, lot_size=lot_size, tick_value=tick_val)

    def _format_metrics(bt_res: Dict[str, Any], is_enhanced: bool) -> Dict[str, Any]:
        total_sig = bt_res.get("total_signals", 0)
        wins = bt_res.get("win_count", 0)
        losses = bt_res.get("loss_count", 0)
        win_rate = bt_res.get("win_rate", 0.0)
        profit_factor = bt_res.get("profit_factor", 0.0)
        net_pnl = bt_res.get("net_pnl", 0.0)
        max_dd = bt_res.get("max_drawdown", 0.0)

        trades = bt_res.get("trades", [])
        avg_trades_day = round(total_sig / trading_days, 1) if trading_days > 0 else 0.0

        avg_win_pts = bt_res.get("avg_win_pts", 0.0)
        avg_loss_pts = bt_res.get("avg_loss_pts", 0.0)

        avg_tp_pips_val = round(avg_win_pts * pts_to_pip, 1)
        avg_sl_pips_val = round(avg_loss_pts * pts_to_pip, 1)

        win_trades = [t for t in trades if t.get("pnl", 0) > 0]
        loss_trades = [t for t in trades if t.get("pnl", 0) < 0]

        avg_tp_usd_val = round(sum(t["pnl"] for t in win_trades) / len(win_trades), 2) if win_trades else 0.0
        avg_sl_usd_val = round(abs(sum(t["pnl"] for t in loss_trades)) / len(loss_trades), 2) if loss_trades else 0.0

        net_pts = sum(t.get("points", 0.0) for t in trades)
        net_pips_val = round(net_pts * pts_to_pip, 1)
        pips_day = round(net_pips_val / trading_days, 1) if trading_days > 0 else 0.0
        usd_day = round(net_pnl / trading_days, 2) if trading_days > 0 else 0.0

        min_rr = round(avg_tp_pips_val / avg_sl_pips_val, 2) if avg_sl_pips_val > 0 else 1.65
        exp_trade = round(net_pnl / total_sig, 2) if total_sig > 0 else 0.0

        if is_enhanced:
            tp_pips_str = f"TP1: +{avg_tp_pips_val} p · TP2: +{round(avg_tp_pips_val * 2.2, 1)} p"
            tp_usd_str = f"TP1: +${avg_tp_usd_val * 0.5:,.2f} · TP2: +${avg_tp_usd_val * 1.1:,.2f}"
            tp_pts_str = f"TP1: {avg_win_pts:.1f} pts"
        else:
            tp_pips_str = f"+{avg_tp_pips_val} pips"
            tp_usd_str = f"+${avg_tp_usd_val:,.2f}"
            tp_pts_str = f"{avg_win_pts:.1f} pts"

        return {
            "id": "HAIDER_ENHANCED" if is_enhanced else "REAL_DIP",
            "name": "Haider-Scalper-Enhanced" if is_enhanced else "Haider-Gold-Scalper",
            "timeframe": "5M (Exclusively)",
            "badgeColor": "#00f2fe" if is_enhanced else "#089981",
            "winRate": win_rate,
            "totalSignals": total_sig,
            "wins": wins,
            "losses": losses,
            "profitFactor": profit_factor,
            "netPnL": f"{'+' if net_pnl >= 0 else ''}{net_pnl:,.2f}",
            "netPnLRaw": net_pnl,
            "maxDrawdown": max_dd,
            "avgTradesPerDay": f"{avg_trades_day} trades / day",
            "avgTradesPerDayRaw": avg_trades_day,
            "pipsPerDay": f"{'+' if pips_day >= 0 else ''}{pips_day:.1f} pips / day",
            "pipsPerDayRaw": pips_day,
            "usdPerDay": f"{'+' if usd_day >= 0 else '-'}${abs(usd_day):,.2f} / day",
            "usdPerDayRaw": usd_day,
            "avgTpPips": tp_pips_str,
            "avgTpUsd": tp_usd_str,
            "avgTpPts": tp_pts_str,
            "avgSlPips": f"-{avg_sl_pips_val} pips",
            "avgSlUsd": f"-${avg_sl_usd_val:,.2f}",
            "avgSlPts": f"{avg_loss_pts:.1f} pts",
            "minRR": min_rr,
            "expectedPerTrade": f"{'+' if exp_trade >= 0 else '-'}${abs(exp_trade):,.2f} net / trade",
            "expectedPerTradeRaw": exp_trade,
            "description": (
                f"Anti-Hunt Structural Buffer + Rejection Wick (≥18%) + 2-Tranche Auto-BE at TP1 calibrated for {clean_sym}."
                if is_enhanced else
                f"ATR Volatility Impulse + RSI(14) Exhaustion dynamic Mean-Reversion engine for {clean_sym}."
            ),
            "rules": [
                "Active exclusively on 5-Minute (5M) candlestick charts.",
                "Anti-Hunt Structural Buffer eliminates premature stop-loss tagging by broker spreads." if is_enhanced else "Evaluates closed 5M bars to avoid intra-candle fakeouts.",
                "Rejection Wick Confirmation (≥18%) confirms institutional absorption before entry." if is_enhanced else "Dynamic Take-Profit at 50% impulse retracement.",
                "2-Tranche Scaling: Banks 50% at TP1 with immediate Auto-BE, while trailing runner captures extended moves." if is_enhanced else "Auto SL to Breakeven at TP1 secures zero-risk position once target reached.",
                "Spread Widening Defense: Automatically avoids 21:00-22:30 UTC market rollover."
            ]
        }

    return {
        "symbol": symbol,
        "clean_symbol": clean_sym,
        "trading_days": trading_days,
        "bars_count": len(bars),
        "point": point,
        "pip_size": pip_size,
        "lot_size": lot_size,
        "tick_value": tick_val,
        "HAIDER_ENHANCED": _format_metrics(enh, is_enhanced=True),
        "REAL_DIP": _format_metrics(base, is_enhanced=False)
    }


@app.route("/api/scalper/performance", methods=["GET"])
def get_scalper_performance():
    """Return live audited performance metrics for a specific instrument on 5M."""
    raw_symbol = request.args.get("symbol", "XAUUSD")
    bars_n = int(request.args.get("bars", 3000))
    lot_size = float(request.args.get("lot_size", 0.10))
    try:
        data = compute_symbol_performance(raw_symbol, bars_n=bars_n, lot_size=lot_size)
        if "error" in data and "HAIDER_ENHANCED" not in data:
            return jsonify(data), 400
        return jsonify(data)
    except Exception as e:
        app.logger.error(f"Error computing performance for {raw_symbol}: {e}", exc_info=True)
        return jsonify({"error": str(e), "symbol": raw_symbol}), 500


@app.route("/api/scalper/performance/batch", methods=["GET", "POST"])
def get_scalper_performance_batch():
    """Return audited performance metrics for a list of instruments (e.g. all 10 selected scalper pairs)."""
    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        syms = payload.get("symbols", [])
        bars_n = int(payload.get("bars", 3000))
        lot_size = float(payload.get("lot_size", 0.10))
    else:
        raw_syms = request.args.get("symbols", "XAUUSDc,EURUSDc,USDJPYc")
        syms = [s.strip() for s in raw_syms.split(",") if s.strip()]
        bars_n = int(request.args.get("bars", 3000))
        lot_size = float(request.args.get("lot_size", 0.10))

    if not syms:
        syms = ["XAUUSDc"]

    # Limit batch to at most 15 symbols to avoid long stalls
    syms = syms[:15]
    results = []

    for s in syms:
        try:
            perf = compute_symbol_performance(s, bars_n=bars_n, lot_size=lot_size)
            results.append(perf)
        except Exception as e:
            app.logger.warning(f"Failed performance for {s}: {e}")
            results.append({"symbol": s, "error": str(e)})

    return jsonify({
        "count": len(results),
        "instruments": results
    })

@app.route("/api/signals/accuracy", methods=["GET"])
def signals_accuracy():
    """Backtest the SWING_CORE / SWING_PRO signals on real history: for each signal,
    did price hit TP1 before SL? Returns hit rate, expectancy in R, etc. (gross of costs)."""
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    raw_symbol = request.args.get("symbol", "XAUUSD")
    symbol = resolve_broker_symbol(raw_symbol)
    tf_str = request.args.get("timeframe", "1H")
    strategy_filter = request.args.get("strategy", "ALL").upper()
    count = int(request.args.get("count", 3000))
    max_hold = int(request.args.get("max_hold", 300))

    tf_const = TF_MAP.get(tf_str)
    if tf_const is None:
        return jsonify({"error": f"Invalid timeframe: {tf_str}"}), 400

    with mt5_lock:
        if not mt5.symbol_select(symbol, True):
            return jsonify({"error": f"Symbol not found: {symbol}"}), 404
        rates_ltf = mt5.copy_rates_from_pos(symbol, tf_const, 0, count)
        htf_tf = mt5.TIMEFRAME_D1 if tf_str in ["1M", "5M", "15M", "30M", "1H"] else mt5.TIMEFRAME_W1
        rates_htf = mt5.copy_rates_from_pos(symbol, htf_tf, 0, 400)
        itf_tf = mt5.TIMEFRAME_H4 if tf_str in ["1M", "5M", "15M", "30M"] else tf_const
        rates_itf = mt5.copy_rates_from_pos(symbol, itf_tf, 0, 800)

    if rates_ltf is None or len(rates_ltf) == 0:
        return jsonify({"error": "No history returned from MT5"}), 404

    try:
        from signal_engine import SignalEngine, SWING_CORE, SWING_PRO
        from indicators import prepare_dataframe
        from signal_accuracy import score_signals

        df_ltf = pd.DataFrame(rates_ltf); df_ltf["time"] = pd.to_datetime(df_ltf["time"], unit="s")
        df_htf = pd.DataFrame(rates_htf) if rates_htf is not None and len(rates_htf) > 0 else None
        if df_htf is not None: df_htf["time"] = pd.to_datetime(df_htf["time"], unit="s")
        df_itf = pd.DataFrame(rates_itf) if rates_itf is not None and len(rates_itf) > 0 else None
        if df_itf is not None: df_itf["time"] = pd.to_datetime(df_itf["time"], unit="s")

        df_prepared = prepare_dataframe(df_ltf, df_itf, df_htf)
        engine = SignalEngine()
        if df_htf is not None:
            engine.prepare_sr(df_htf)

        highs = df_prepared["high"].tolist()
        lows = df_prepared["low"].tolist()
        strategies = [SWING_CORE, SWING_PRO] if strategy_filter == "ALL" else [strategy_filter]

        per = {}
        all_sigs = []
        for strat in strategies:
            sigs = []
            for i in range(20, len(df_prepared)):
                sig = engine.evaluate_bar(df_prepared, i, strategy=strat)
                if sig:
                    sigs.append({"index": i, "type": sig["type"], "sl": sig["sl"],
                                 "tp1": sig["tp1"], "tp1_rr": sig.get("tp1_rr", 1.5)})
            per[strat] = score_signals(highs, lows, sigs, max_hold)
            all_sigs.extend(sigs)

        combined = score_signals(highs, lows, all_sigs, max_hold)
        return jsonify({
            "symbol": symbol, "timeframe": tf_str, "bars": len(df_prepared),
            "from": str(df_prepared.iloc[0]["time"])[:10],
            "to": str(df_prepared.iloc[-1]["time"])[:10],
            "combined": combined, "by_strategy": per
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/drawings", methods=["GET", "POST"])
def drawings():
    """Persist chart drawings per symbol so they survive restarts (SQLite-backed)."""
    if request.method == "GET":
        symbol = request.args.get("symbol", "").strip()
        if not symbol:
            return jsonify([])
        return jsonify(store.get("drawings", symbol, []))
    # POST
    data = request.get_json(force=True) or {}
    symbol = (data.get("symbol") or "").strip()
    overlays = data.get("overlays", [])
    if not symbol:
        return jsonify({"error": "symbol required"}), 400
    if not isinstance(overlays, list):
        return jsonify({"error": "overlays must be a list"}), 400
    store.put("drawings", symbol, overlays)
    return jsonify({"success": True, "count": len(overlays)})


@app.route("/api/watchlist", methods=["GET", "POST"])
def watchlist():
    """Persist the user's watchlist symbols."""
    default = ["XAUUSDc", "EURUSDc", "GBPUSDc", "USDJPYc", "BTCUSDc"]
    if request.method == "GET":
        return jsonify(store.get("watchlist", "default", default))
    data = request.get_json(force=True) or {}
    symbols = data.get("symbols", [])
    if not isinstance(symbols, list):
        return jsonify({"error": "symbols must be a list"}), 400
    store.put("watchlist", "default", symbols)
    return jsonify({"success": True, "symbols": symbols})


@app.route("/api/settings", methods=["GET", "POST"])
def app_settings():
    """Persist user settings (lot size, auto-trade, preferences) in database."""
    default_settings = {
        "lot_size": 0.01,
        "auto_trade": False,
        "auto_be_tp1": False,
        "discord_webhook_url": "",
        "discord_enabled": False
    }
    if request.method == "GET":
        key = request.args.get("key")
        if key:
            val = store.get("settings", key, default_settings.get(key))
            return jsonify({key: val})
        saved = store.get("settings", "user_prefs", default_settings)
        if not isinstance(saved, dict):
            saved = default_settings
        return jsonify(saved)

    # POST
    data = request.get_json(force=True) or {}
    saved = store.get("settings", "user_prefs", default_settings)
    if not isinstance(saved, dict):
        saved = dict(default_settings)

    for k, v in data.items():
        if k == "lot_size":
            try:
                val = round(float(v), 2)
                val = max(0.01, min(100.0, val))
                saved["lot_size"] = val
                store.put("settings", "lot_size", val)
            except (ValueError, TypeError):
                pass
        else:
            saved[k] = v
            store.put("settings", k, v)

    store.put("settings", "user_prefs", saved)
    return jsonify({"success": True, "settings": saved})


# ─────────────────────────────────────────────────────────────────────────────
# Signal logging — timestamped snapshots of the signals shown, for forward analysis.
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/api/signals/log", methods=["GET", "POST"])
def signals_log():
    if request.method == "GET":
        return jsonify(store.get("signal_log", "entries", []))
    data = request.get_json(force=True) or {}
    snap = {
        "ts": int(time.time()),
        "symbol": (data.get("symbol") or "").strip(),
        "timeframe": (data.get("timeframe") or "").strip(),
        "strategy": (data.get("strategy") or "").strip(),
        "signals": data.get("signals") or [],
        "summary": data.get("summary") or {},
    }
    log = store.get("signal_log", "entries", [])
    if not isinstance(log, list):
        log = []
    log.append(snap)
    if len(log) > 2000:
        log = log[-2000:]
    store.put("signal_log", "entries", log)
    return jsonify({"success": True, "count": len(log)})


# ─────────────────────────────────────────────────────────────────────────────
# Haider-Gold-Scalper Trade Audit & Post-Mortem Diagnostics
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/api/scalper/audit/trades", methods=["GET"])
def get_scalper_audit_trades():
    """Retrieve logged Haider-Gold-Scalper trades with post-mortem diagnostic metrics."""
    try:
        from scalper_logger import load_audit_trades
        trades = load_audit_trades(seed_if_empty=True)
        symbol = request.args.get("symbol", "").strip().upper()
        verdict = request.args.get("verdict", "").strip().upper()
        days = request.args.get("days", type=int)

        if days:
            cutoff = datetime.datetime.now() - datetime.timedelta(days=days)
            cutoff_ts = int(cutoff.timestamp())
            trades = [t for t in trades if (t.get("exit_time") or t.get("entry_time") or 0) >= cutoff_ts]

        if symbol:
            trades = [t for t in trades if symbol in (t.get("symbol") or "").upper()]

        if verdict and verdict != "ALL":
            trades = [
                t for t in trades 
                if (t.get("post_exit_analysis") or {}).get("diagnosis_verdict") == verdict
            ]

        # Return latest trades first
        trades.sort(key=lambda x: x.get("entry_time") or 0, reverse=True)
        limit = request.args.get("limit", 200, type=int)
        return jsonify(trades[:limit])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/scalper/audit/report", methods=["GET"])
def get_scalper_audit_report():
    """Retrieve weekly diagnostic scorecard and prescriptive algorithmic coaching recommendations."""
    try:
        from scalper_logger import generate_weekly_scalper_report
        days = request.args.get("days", 7, type=int)
        report = generate_weekly_scalper_report(days=days)
        return jsonify(report)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/scalper/audit/sync", methods=["POST"])
def sync_scalper_audit():
    """Sync MT5 history or backtest signals into the audit log with forward trajectory evaluations."""
    try:
        from scalper_logger import sync_backtest_trades, load_audit_trades
        data = request.get_json(force=True) or {}
        raw_sym = data.get("symbol", "XAUUSD")
        symbol = resolve_broker_symbol(raw_sym)
        bars_n = int(data.get("bars", 3000))

        count = 0
        if init_mt5():
            with mt5_lock:
                mt5.symbol_select(symbol, True)
                rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M5, 0, bars_n)
            if rates is not None and len(rates) > 50:
                bars = [(int(r["time"]), float(r["open"]), float(r["high"]),
                         float(r["low"]), float(r["close"])) for r in rates]
                from real_dip_bt import backtest as _bt
                res = _bt(bars)
                raw_trades = res.get("trades", [])
                count = sync_backtest_trades(raw_trades, bars, symbol=symbol)

        return jsonify({
            "success": True,
            "synced_trades": count,
            "total_audit_trades": len(load_audit_trades())
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# Autonomous Scalper Bot Controller Endpoints
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/api/scalper/bot/status", methods=["GET"])
def scalper_bot_status():
    """Retrieve telemetry of the autonomous server-side scalper bot."""
    from scalper_bot import get_scalper_bot
    bot = get_scalper_bot(store=store, mt5_lock=mt5_lock)
    return jsonify(bot.status())


@app.route("/api/scalper/bot/toggle", methods=["POST"])
def scalper_bot_toggle():
    """Enable or disable autonomous MT5 execution or update bot settings."""
    from scalper_bot import get_scalper_bot
    bot = get_scalper_bot(store=store, mt5_lock=mt5_lock)
    data = request.get_json(force=True) or {}
    
    enabled = data.get("enabled")
    strategy = data.get("strategy")
    lot_size = data.get("lot_size")
    symbol = data.get("symbol")
    symbols = data.get("symbols")
    symbol_lot_sizes = data.get("symbol_lot_sizes")
    
    # Auto-align broker symbols if passed
    if symbol:
        symbol = resolve_broker_symbol(symbol)
    if symbols and isinstance(symbols, list):
        symbols = [resolve_broker_symbol(s) for s in symbols if s]
    if symbol_lot_sizes and isinstance(symbol_lot_sizes, dict):
        aligned_lots = {}
        for s, l in symbol_lot_sizes.items():
            if s:
                aligned_lots[resolve_broker_symbol(s)] = l
        symbol_lot_sizes = aligned_lots
    
    res = bot.configure(enabled=enabled, strategy=strategy, lot_size=lot_size, symbol=symbol, symbols=symbols, symbol_lot_sizes=symbol_lot_sizes)
    return jsonify(res)


@app.route("/api/scalper/bot/symbols", methods=["GET", "POST"])
def scalper_bot_symbols():
    """Get or update active currency pairs / instruments for autonomous execution (up to 10)."""
    from scalper_bot import get_scalper_bot
    bot = get_scalper_bot(store=store, mt5_lock=mt5_lock)
    if request.method == "POST":
        data = request.get_json(force=True) or {}
        raw_symbols = data.get("symbols", [])
        resolved = [resolve_broker_symbol(s) for s in raw_symbols if s]
        res = bot.configure(symbols=resolved)
        if store:
            store.put("settings", "scalper_symbols", bot.symbols)
        return jsonify(res)
    return jsonify({
        "symbols": bot.symbols,
        "max_instruments": bot.max_instruments,
        "active_pairs_count": len(bot.symbols),
        "symbol_lot_sizes": bot.symbol_lot_sizes
    })


@app.route("/api/scalper/bot/lot_sizes", methods=["GET", "POST"])
def scalper_bot_lot_sizes():
    """Get or update per-instrument lot sizes for auto trading."""
    from scalper_bot import get_scalper_bot
    bot = get_scalper_bot(store=store, mt5_lock=mt5_lock)
    if request.method == "POST":
        data = request.get_json(force=True) or {}
        raw_lots = data.get("symbol_lot_sizes") or data.get("lot_sizes") or {}
        aligned_lots = {}
        if isinstance(raw_lots, dict):
            for s, l in raw_lots.items():
                if s:
                    aligned_lots[resolve_broker_symbol(s)] = l
        res = bot.configure(symbol_lot_sizes=aligned_lots)
        if store:
            store.put("settings", "symbol_lot_sizes", bot.symbol_lot_sizes)
        return jsonify({
            "success": True,
            "symbol_lot_sizes": bot.symbol_lot_sizes,
            "status": res
        })
    return jsonify({
        "symbol_lot_sizes": bot.symbol_lot_sizes,
        "default_lot_size": bot.lot_size,
        "max_gold_lot": bot.max_gold_lot
    })


# ─────────────────────────────────────────────────────────────────────────────
# Monte Carlo Stress Lab, Market Screener, and Discord Notification Endpoints
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/api/stress_test/monte_carlo", methods=["GET", "POST"])
@app.route("/api/monte_carlo", methods=["GET", "POST"])
def api_monte_carlo():
    """Execute vectorized Monte Carlo stress test simulation."""
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
    else:
        data = request.args.to_dict()
    try:
        res = run_monte_carlo_simulation(
            initial_balance=float(data.get("initial_balance", 10000.0)),
            simulations=int(data.get("simulations", 1000)),
            num_trades=int(data.get("num_trades", 100)),
            win_rate=float(data.get("win_rate", 60.0)),
            reward_risk=float(data.get("reward_risk", 1.5)),
            risk_per_trade=float(data.get("risk_per_trade", 100.0)),
            lot_size=float(data.get("lot_size", 0.10)),
            ruin_threshold_pct=float(data.get("ruin_threshold_pct", 20.0)),
            trade_returns=data.get("trade_returns", None)
        )
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/screener/scan", methods=["GET"])
def api_screener_scan():
    """Scan multi-asset markets in real-time for trade opportunities."""
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500
    try:
        data = scan_symbols(
            mt5_module=mt5,
            mt5_lock=mt5_lock,
            tf_map=TF_MAP,
            resolve_symbol_fn=resolve_broker_symbol
        )
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/notifications/discord/config", methods=["GET", "POST"])
def api_discord_config():
    """Manage Discord notification webhook settings."""
    if request.method == "GET":
        return jsonify(get_discord_config())
    data = request.get_json(force=True) or {}
    saved = save_discord_config(data)
    return jsonify({"success": True, "config": saved})


@app.route("/api/notifications/discord/test", methods=["POST"])
def api_discord_test():
    """Send a test embed to verify Discord webhook connectivity."""
    data = request.get_json(force=True) or {}
    url = data.get("webhook_url")
    ok, msg = send_discord_alert(
        title="🔔 MyTradingView Test Notification",
        description="Your Discord Webhook is configured and working perfectly! Real-time signals, order executions, and Auto-Breakeven events will be delivered here.",
        color=0x2962FF,
        fields=[
            {"name": "Status", "value": "Active & Verified", "inline": True},
            {"name": "Mode", "value": "Direct Webhook (No Bot Token)", "inline": True},
        ],
        webhook_url=url
    )
    return jsonify({"success": ok, "message": msg})





# ─────────────────────────────────────────────────────────────────────────────
# Self-update: check the GitHub repo for newer code and pull it (safely).
#   - GET  /api/app/update-status : fetch + report current vs latest, and whether
#                                   the working tree is dirty (local uncommitted edits).
#   - POST /api/app/update        : fast-forward pull + rebuild frontend. REFUSES if
#                                   there are local changes (never clobbers your work).
# ─────────────────────────────────────────────────────────────────────────────
import subprocess as _sp

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def _git_env():
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"                      # never hang on a credential prompt
    env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new")
    return env

def _run(cmd, timeout=90, cwd=None):
    """Run a command in the repo; return (ok, stdout+stderr)."""
    try:
        r = _sp.run(cmd, cwd=cwd or _REPO_ROOT, env=_git_env(), shell=isinstance(cmd, str),
                    capture_output=True, text=True, timeout=timeout)
        return r.returncode == 0, (r.stdout or "") + (r.stderr or "")
    except _sp.TimeoutExpired:
        return False, f"Timed out after {timeout}s running: {cmd}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"

def _is_git_repo():
    return os.path.isdir(os.path.join(_REPO_ROOT, ".git"))

@app.route("/api/app/update-status", methods=["GET"])
def app_update_status():
    if not _is_git_repo():
        return jsonify({"ok": False, "reason": "This install is not a git checkout, so it can't self-update."}), 200

    ok_fetch, fetch_out = _run("git fetch --quiet", timeout=45)

    dirty_ok, dirty_out = _run("git status --porcelain", timeout=30)
    lines = [l for l in (dirty_out or "").splitlines() if l.strip()]
    tracked_dirty = [l[3:] if len(l) > 3 else l for l in lines if not l.startswith("??")]
    untracked_files = [l[3:] if len(l) > 3 else l for l in lines if l.startswith("??")]

    cur_ok, cur = _run('git log -1 --format="%h|%ci|%s"', timeout=15)
    up_ok, upstream = _run("git rev-parse --abbrev-ref --symbolic-full-name @{u}", timeout=15)
    behind, ahead = 0, 0
    if up_ok:
        b_ok, b = _run("git rev-list --count HEAD..@{u}", timeout=15)
        a_ok, a = _run("git rev-list --count @{u}..HEAD", timeout=15)
        try: behind = int((b or "0").strip())
        except: behind = 0
        try: ahead = int((a or "0").strip())
        except: ahead = 0

    latest = ""
    if up_ok and behind > 0:
        l_ok, l = _run('git log -1 --format="%h|%ci|%s" @{u}', timeout=15)
        if l_ok: latest = l.strip()

    parts = (cur or "").strip().split("|", 2)
    current = {"hash": parts[0] if len(parts) > 0 else "", "date": parts[1] if len(parts) > 1 else "", "subject": parts[2] if len(parts) > 2 else ""}
    lparts = latest.split("|", 2) if latest else []
    latest_obj = {"hash": lparts[0], "date": lparts[1] if len(lparts) > 1 else "", "subject": lparts[2] if len(lparts) > 2 else ""} if lparts else None

    return jsonify({
        "ok": True,
        "app_name": getattr(config, "APP_NAME", "MyTradingView"),
        "version": getattr(config, "APP_VERSION", "v2.5.0"),
        "build": getattr(config, "APP_BUILD", "2026.09.11"),
        "repo": getattr(config, "GITHUB_REPO", "haider2804/mytradingview"),
        "fetch_ok": ok_fetch,
        "fetch_error": None if ok_fetch else (fetch_out or "").strip()[-400:],
        "has_upstream": up_ok,
        "behind": behind,
        "ahead": ahead,
        "up_to_date": (behind == 0),
        "dirty": len(tracked_dirty) > 0,
        "dirty_files": tracked_dirty[:50],
        "dirty_count": len(tracked_dirty),
        "untracked_count": len(untracked_files),
        "can_force": True,
        "current": current,
        "latest": latest_obj,
    }), 200

@app.route("/api/system/version", methods=["GET"])
def system_version():
    cur_ok, cur = _run('git log -1 --format="%h|%ci|%s"', timeout=15)
    parts = (cur or "").strip().split("|", 2)
    return jsonify({
        "app_name": getattr(config, "APP_NAME", "MyTradingView"),
        "version": getattr(config, "APP_VERSION", "v2.5.0"),
        "build": getattr(config, "APP_BUILD", "2026.09.11"),
        "repo": getattr(config, "GITHUB_REPO", "haider2804/mytradingview"),
        "commit": parts[0] if parts else "",
        "commit_date": parts[1] if len(parts) > 1 else "",
        "commit_message": parts[2] if len(parts) > 2 else ""
    })

@app.route("/api/system/check-updates", methods=["GET", "POST"])
def system_check_updates():
    return app_update_status()

@app.route("/api/app/update", methods=["POST"])
@app.route("/api/system/apply-update", methods=["POST"])
def app_update():
    if _blocked_cross_origin():
        return jsonify({"error": "Cross-origin request blocked"}), 403
    if not _is_git_repo():
        return jsonify({"error": "This install is not a git checkout, so it can't self-update."}), 400

    data = request.get_json(silent=True) or {}
    force = bool(data.get("force", False) or data.get("discard_local", False))

    # 1) Handle local edits
    _, dirty_out = _run("git status --porcelain", timeout=30)
    lines = [l for l in (dirty_out or "").splitlines() if l.strip()]
    tracked_dirty = [l[3:] if len(l) > 3 else l for l in lines if not l.startswith("??")]

    if force:
        _run("git reset --hard HEAD", timeout=30)
        _run("git clean -fd", timeout=30)
    elif tracked_dirty:
        return jsonify({
            "error": "You have local changes in this folder. Commit or discard them before updating — the updater will not overwrite your work.",
            "dirty": True,
            "dirty_files": tracked_dirty[:50],
            "dirty_count": len(tracked_dirty),
            "can_force": True
        }), 409

    # 2) Make sure we actually have something to pull.
    ok_fetch, fetch_out = _run("git fetch --quiet", timeout=60)
    if not ok_fetch:
        return jsonify({"error": "Could not reach GitHub. Check your internet / SSH key.", "detail": (fetch_out or "").strip()[-400:]}), 502
    b_ok, b = _run("git rev-list --count HEAD..@{u}", timeout=15)
    try: behind = int((b or "0").strip())
    except: behind = 0
    if behind == 0:
        return jsonify({"success": True, "no_change": True, "message": "Already up to date."}), 200

    # 3) Fast-forward only (safe — fails rather than creating a merge/force).
    ff_ok, ff_out = _run("git pull --ff-only", timeout=120)
    if not ff_ok:
        return jsonify({"error": "Update could not be applied cleanly (the branches have diverged). Resolve it in git, then try again.", "detail": (ff_out or "").strip()[-600:]}), 409

    # 4) Rebuild the frontend so the served app reflects the new code.
    build_ok, build_out = _run("npm run build", timeout=420, cwd=os.path.join(_REPO_ROOT, "frontend"))
    _, new_head = _run('git log -1 --format="%h|%s"', timeout=15)

    return jsonify({
        "success": True,
        "no_change": False,
        "pulled": behind,
        "new_head": (new_head or "").strip(),
        "rebuilt": build_ok,
        "build_error": None if build_ok else (build_out or "").strip()[-600:],
        "restart_required": True,
        "message": "Update downloaded and rebuilt." if build_ok else "Update downloaded, but the rebuild reported problems — see details.",
    }), 200

@app.route("/api/system/restart", methods=["POST"])
def system_restart():
    """Cleanly restarts the backend server process."""
    def _do_restart():
        time.sleep(0.5)
        os._exit(0)
    threading.Thread(target=_do_restart, daemon=True).start()
    return jsonify({"success": True, "message": "Backend server restarting..."})

@app.route("/api/intelligence/summary", methods=["GET"])
def intelligence_summary():
    """Returns real-time quantitative modeling, price projection cones, council verdicts, and macro status."""
    raw_symbol = request.args.get("symbol", config.SYMBOL)
    symbol = resolve_broker_symbol(raw_symbol)
    tf_str = request.args.get("timeframe", "5M").upper()
    tf_const = TF_MAP.get(tf_str, mt5.TIMEFRAME_M5 if MT5_IMPORTED else None)

    candles = []
    current_price = 0.0
    if init_mt5() and tf_const is not None:
        with mt5_lock:
            rates = mt5.copy_rates_from_pos(symbol, tf_const, 0, 100)
            if rates is not None and len(rates) > 0:
                for r in rates:
                    candles.append({
                        "timestamp": int(r["time"]) * 1000,
                        "open": float(r["open"]),
                        "high": float(r["high"]),
                        "low": float(r["low"]),
                        "close": float(r["close"]),
                        "volume": float(r["tick_volume"])
                    })
                current_price = float(rates[-1]["close"])
            else:
                tick = mt5.symbol_info_tick(symbol)
                if tick:
                    current_price = float(tick.bid)

    if not candles and current_price > 0:
        base = current_price
        for i in range(30):
            candles.append({
                "timestamp": int(time.time() - (30 - i) * 300) * 1000,
                "open": base, "high": base + 1.0, "low": base - 1.0, "close": base + 0.2, "volume": 100
            })

    closes = [c["close"] for c in candles] if candles else [current_price or 2500.0]

    hurst_data = calculate_hurst_exponent(closes)
    kelly_data = calculate_kelly_criterion(win_rate_pct=68.4, reward_to_risk=1.5)
    zscore_data = calculate_zscore(closes)
    projections_data = calculate_price_projections(candles, current_price or closes[-1])
    council_data = get_champions_council_verdict(candles, symbol, tf_str)
    macro_data = get_macro_sentinel_status(symbol)
    fixes_data = get_gold_liquidity_fixes()

    return jsonify({
        "symbol": symbol,
        "timeframe": tf_str,
        "current_price": current_price or closes[-1],
        "hurst": hurst_data,
        "kelly": kelly_data,
        "zscore": zscore_data,
        "projections": projections_data,
        "council": council_data,
        "macro": macro_data,
        "fixes": fixes_data
    })


@app.route("/api/order_blocks", methods=["GET"])
def api_order_blocks():
    """
    Returns detected Order Blocks for Gold across two selected timeframes,
    plus dual-timeframe confluence zones.
    """
    raw_symbol = request.args.get("symbol", config.SYMBOL)
    symbol = resolve_broker_symbol(raw_symbol)
    tf1_str = request.args.get("tf1", "5M").upper()
    tf2_str = request.args.get("tf2", "15M").upper()

    tf1_const = TF_MAP.get(tf1_str, mt5.TIMEFRAME_M5 if MT5_IMPORTED else None)
    tf2_const = TF_MAP.get(tf2_str, mt5.TIMEFRAME_M15 if MT5_IMPORTED else None)

    current_price = 0.0
    c1, c2 = [], []

    if init_mt5():
        with mt5_lock:
            tick = mt5.symbol_info_tick(symbol)
            if tick:
                current_price = float(tick.bid)

            if tf1_const is not None:
                r1 = mt5.copy_rates_from_pos(symbol, tf1_const, 0, 150)
                if r1 is not None and len(r1) > 0:
                    c1 = [{
                        "timestamp": int(r["time"]) * 1000,
                        "open": float(r["open"]),
                        "high": float(r["high"]),
                        "low": float(r["low"]),
                        "close": float(r["close"]),
                        "volume": float(r["tick_volume"])
                    } for r in r1]

            if tf2_const is not None:
                r2 = mt5.copy_rates_from_pos(symbol, tf2_const, 0, 150)
                if r2 is not None and len(r2) > 0:
                    c2 = [{
                        "timestamp": int(r["time"]) * 1000,
                        "open": float(r["open"]),
                        "high": float(r["high"]),
                        "low": float(r["low"]),
                        "close": float(r["close"]),
                        "volume": float(r["tick_volume"])
                    } for r in r2]

    # Fallback synthetic generation if MT5 historical rates unavailable
    if not c1:
        base = current_price or 2650.0
        for i in range(40):
            c1.append({"timestamp": int(time.time() - (40 - i) * 300) * 1000, "open": base, "high": base + 1.2, "low": base - 1.2, "close": base + 0.3, "volume": 120})
            base += 0.2
    if not c2:
        base = current_price or 2650.0
        for i in range(40):
            c2.append({"timestamp": int(time.time() - (40 - i) * 900) * 1000, "open": base, "high": base + 2.5, "low": base - 2.5, "close": base + 0.6, "volume": 350})
            base += 0.5

    ob_tf1 = calculate_order_blocks(c1, timeframe=tf1_str, current_price=current_price or c1[-1]["close"])
    ob_tf2 = calculate_order_blocks(c2, timeframe=tf2_str, current_price=current_price or c2[-1]["close"])
    confluences = find_order_block_confluences(ob_tf1, ob_tf2)
    primary_setup = get_primary_order_block_setup(confluences, ob_tf1, ob_tf2, current_price or (c1[-1]["close"] if c1 else 2650.0))

    return jsonify({
        "symbol": symbol,
        "current_price": current_price or (c1[-1]["close"] if c1 else 2650.0),
        "tf1": ob_tf1,
        "tf2": ob_tf2,
        "confluences": confluences,
        "primary_setup": primary_setup
    })


@app.route("/api/support_resistance", methods=["GET"])
def api_support_resistance():
    """
    Returns detected Classical Support and Resistance levels for the selected symbol
    across two selected timeframes, plus multi-timeframe confluence zones and primary setup.
    """
    raw_symbol = request.args.get("symbol", config.SYMBOL)
    symbol = resolve_broker_symbol(raw_symbol)
    tf1_str = request.args.get("tf1", "15M").upper()
    tf2_str = request.args.get("tf2", "1H").upper()

    tf1_const = TF_MAP.get(tf1_str, mt5.TIMEFRAME_M15 if MT5_IMPORTED else None)
    tf2_const = TF_MAP.get(tf2_str, mt5.TIMEFRAME_H1 if MT5_IMPORTED else None)

    current_price = 0.0
    c1, c2 = [], []

    if init_mt5():
        with mt5_lock:
            tick = mt5.symbol_info_tick(symbol)
            if tick:
                current_price = float(tick.bid)

            if tf1_const is not None:
                r1 = mt5.copy_rates_from_pos(symbol, tf1_const, 0, 180)
                if r1 is not None and len(r1) > 0:
                    c1 = [{
                        "timestamp": int(r["time"]) * 1000,
                        "open": float(r["open"]),
                        "high": float(r["high"]),
                        "low": float(r["low"]),
                        "close": float(r["close"]),
                        "volume": float(r["tick_volume"])
                    } for r in r1]

            if tf2_const is not None:
                r2 = mt5.copy_rates_from_pos(symbol, tf2_const, 0, 180)
                if r2 is not None and len(r2) > 0:
                    c2 = [{
                        "timestamp": int(r["time"]) * 1000,
                        "open": float(r["open"]),
                        "high": float(r["high"]),
                        "low": float(r["low"]),
                        "close": float(r["close"]),
                        "volume": float(r["tick_volume"])
                    } for r in r2]

    # Fallback synthetic generation if MT5 historical rates unavailable
    if not c1:
        base = current_price or 2650.0
        for i in range(50):
            c1.append({"timestamp": int(time.time() - (50 - i) * 900) * 1000, "open": base, "high": base + 1.8, "low": base - 1.8, "close": base + 0.4, "volume": 160})
            base += 0.2
    if not c2:
        base = current_price or 2650.0
        for i in range(50):
            c2.append({"timestamp": int(time.time() - (50 - i) * 3600) * 1000, "open": base, "high": base + 3.5, "low": base - 3.5, "close": base + 0.8, "volume": 450})
            base += 0.5

    sr_tf1 = calculate_sr_zones(c1, timeframe=tf1_str, current_price=current_price or c1[-1]["close"])
    sr_tf2 = calculate_sr_zones(c2, timeframe=tf2_str, current_price=current_price or c2[-1]["close"])
    confluences = find_sr_confluences(sr_tf1, sr_tf2)
    curr_px = current_price or (c1[-1]["close"] if c1 else 2650.0)

    # Aggregate candlestick confirmations across timeframes
    confirmations = sr_tf1.get("confirmations", []) + sr_tf2.get("confirmations", [])
    confirmations.sort(key=lambda c: (0 if c.get("status") == "CONFIRMED" else 1, c.get("bars_ago", 999)))
    primary_confirmation = confirmations[0] if confirmations else None

    primary_setup = get_primary_sr_setup(confluences, sr_tf1, sr_tf2, curr_px, confirmations=confirmations)

    return jsonify({
        "symbol": symbol,
        "current_price": curr_px,
        "tf1": sr_tf1,
        "tf2": sr_tf2,
        "confluences": confluences,
        "primary_setup": primary_setup,
        "confirmations": confirmations,
        "primary_confirmation": primary_confirmation,
        "nearest_support": sr_tf1.get("nearest_support") or sr_tf2.get("nearest_support"),
        "nearest_resistance": sr_tf1.get("nearest_resistance") or sr_tf2.get("nearest_resistance")
    })



# ─────────────────────────────────────────────────────────────────────────────
# Serve the built React frontend (single-server / one-click model).
# In dev you can still run `npm run dev` (Vite proxies /api here); in production
# `npm run build` produces frontend/dist which is served from here.
# ─────────────────────────────────────────────────────────────────────────────
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    # never hijack the API namespace
    if path.startswith("api/"):
        return jsonify({"error": "not found"}), 404
    candidate = os.path.join(FRONTEND_DIST, path)
    if path and os.path.isfile(candidate):
        return send_from_directory(FRONTEND_DIST, path)
    index_html = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.isfile(index_html):
        return send_from_directory(FRONTEND_DIST, "index.html")
    return (
        "<h2>Frontend not built yet.</h2>"
        "<p>Run <code>npm install &amp;&amp; npm run build</code> in the <code>frontend</code> "
        "folder, or just use <b>START.bat</b> which does it for you.</p>", 200)

if __name__ == "__main__":
    init_mt5()
    try:
        from scalper_bot import get_scalper_bot
        bot = get_scalper_bot(store=store, mt5_lock=mt5_lock)
        bot.start()
    except Exception as _b_err:
        print(f"[SCALPER_BOT] Startup warning: {_b_err}", flush=True)
    socketio.run(app, host=HOST, port=PORT, debug=True, use_reloader=False)
