import os
import time
import threading
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO
import store
import pandas as pd
import ta
import threading
import time

try:
    import MetaTrader5 as mt5
    MT5_IMPORTED = True
except Exception:
    mt5 = None
    MT5_IMPORTED = False

app = Flask(__name__)

# Only the app's own local origins may call the API from a browser. This blocks
# a malicious web page you have open from POSTing to the local trade endpoints
# (drive-by CSRF against a money-moving localhost server).
ALLOWED_ORIGINS = [
    "http://127.0.0.1:5000", "http://localhost:5000",
    "http://127.0.0.1:5173", "http://localhost:5173",
]
CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGINS}})
socketio = SocketIO(app, cors_allowed_origins=ALLOWED_ORIGINS)

def _blocked_cross_origin():
    """True when a browser sends a cross-origin request to a protected endpoint.
    Non-browser clients (curl, the user's own scripts) send no Origin and are allowed."""
    origin = request.headers.get("Origin")
    return origin is not None and origin not in ALLOWED_ORIGINS

mt5_lock = threading.RLock()
_initialized = False

def init_mt5():
    global _initialized
    if not MT5_IMPORTED: return False
    with mt5_lock:
        info = mt5.terminal_info()
        if not _initialized or info is None or not info.connected:
            if not mt5.initialize():
                _initialized = False
                return False
            _initialized = True
        return True

@app.before_request
def before_req():
    init_mt5()

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

@app.route("/api/positions", methods=["GET"])
def get_positions():
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    with mt5_lock:
        positions = mt5.positions_get()
        if not positions:
            return jsonify([])

        out = []
        for p in positions:
            p_dict = p._asdict()
            p_dict["type_str"] = "BUY" if p_dict.get("type") == 0 else "SELL"
            p_dict["category"] = categorize_symbol(p_dict.get("symbol", ""))
            p_dict["time_str"] = datetime.datetime.fromtimestamp(p_dict.get("time", 0)).strftime("%Y-%m-%d %H:%M:%S") if p_dict.get("time") else ""
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
    symbol = data.get("symbol", "").strip()
    order_type_str = (data.get("type") or "BUY").upper()
    try:
        volume = round(float(data.get("volume", 0.01)), 2)
    except (ValueError, TypeError):
        volume = 0.01
    
    sl = float(data.get("sl") or 0.0)
    tp = float(data.get("tp") or 0.0)
    comment = data.get("comment", "Trade-with-Rakhi")

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
            "comment": comment,
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

        return jsonify({
            "success": True,
            "order": res.order,
            "deal": res.deal,
            "price": res.price,
            "ticket": pos.ticket,
            "profit": pos.profit,
            "comment": res.comment
        })

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

    symbol = request.args.get("symbol", "XAUUSD")
    tf_str = request.args.get("timeframe", "1H")
    count = int(request.args.get("count", 1000))
    to_param = request.args.get("to")  # unix seconds; load `count` bars strictly older than this

    tf_const = TF_MAP.get(tf_str)
    if tf_const is None:
        return jsonify({"error": f"Invalid timeframe: {tf_str}"}), 400

    with mt5_lock:
        if not mt5.symbol_select(symbol, True):
            return jsonify({"error": f"Symbol not found: {symbol}"}), 404

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
        else:
            rates = mt5.copy_rates_from_pos(symbol, tf_const, 0, count)

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

    symbol = request.args.get("symbol", "XAUUSD")
    with mt5_lock:
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
    Generic endpoint to calculate indicators via pandas-ta.
    Example: /api/indicator?symbol=EURUSD&timeframe=1H&type=rsi&length=14
    """
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    symbol = request.args.get("symbol", "XAUUSD")
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

    symbol = request.args.get("symbol", "XAUUSDc")
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
            try:
                mt5.symbol_select(name, True)
                tick = mt5.symbol_info_tick(name)
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

    symbol = request.args.get("symbol", "XAUUSDc")
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

@app.route("/api/signals/accuracy", methods=["GET"])
def signals_accuracy():
    """Backtest the SWING_CORE / SWING_PRO signals on real history: for each signal,
    did price hit TP1 before SL? Returns hit rate, expectancy in R, etc. (gross of costs)."""
    if not init_mt5():
        return jsonify({"error": "MT5 not connected"}), 500

    symbol = request.args.get("symbol", "XAUUSDc")
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
# Academy (Trader's Gym) — knowledge log + stats for the daily skills game.
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/api/academy/log", methods=["POST"])
def academy_log():
    data = request.get_json(force=True) or {}
    entry = {
        "ts": int(time.time()),
        "date": (data.get("date") or "").strip(),
        "category": (data.get("category") or "misc").strip(),
        "kind": (data.get("kind") or "").strip(),
        "questionId": (data.get("questionId") or "").strip(),
        "correct": bool(data.get("correct")),
        "userAnswer": data.get("userAnswer"),
        "correctAnswer": data.get("correctAnswer"),
    }
    log = store.get("academy", "log", [])
    if not isinstance(log, list):
        log = []
    log.append(entry)
    if len(log) > 5000:
        log = log[-5000:]
    store.put("academy", "log", log)
    return jsonify({"success": True, "count": len(log)})


@app.route("/api/academy/stats", methods=["GET"])
def academy_stats():
    log = store.get("academy", "log", [])
    if not isinstance(log, list):
        log = []
    by_cat, by_date = {}, {}
    total = correct = 0
    for e in log:
        cat = e.get("category", "misc")
        c = by_cat.setdefault(cat, {"total": 0, "correct": 0})
        c["total"] += 1
        if e.get("correct"):
            c["correct"] += 1
            correct += 1
        total += 1
        d = e.get("date", "")
        dd = by_date.setdefault(d, {"total": 0, "correct": 0})
        dd["total"] += 1
        if e.get("correct"):
            dd["correct"] += 1
    for c in by_cat.values():
        c["accuracy"] = round(c["correct"] / c["total"] * 100, 1) if c["total"] else 0
    for d in by_date.values():
        d["accuracy"] = round(d["correct"] / d["total"] * 100, 1) if d["total"] else 0
    return jsonify({
        "total": total,
        "correct": correct,
        "accuracy": round(correct / total * 100, 1) if total else 0,
        "by_category": by_cat,
        "by_date": by_date,
        "recent": log[-60:],
    })


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

    ok_fetch, fetch_out = _run("git fetch --quiet", timeout=60)
    dirty_ok, dirty_out = _run("git status --porcelain", timeout=30)
    dirty_files = [l for l in (dirty_out or "").splitlines() if l.strip()]

    cur_ok, cur = _run('git log -1 --format=%h|%ci|%s', timeout=15)
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
        l_ok, l = _run('git log -1 --format=%h|%ci|%s @{u}', timeout=15)
        if l_ok: latest = l.strip()

    parts = (cur or "").strip().split("|", 2)
    current = {"hash": parts[0] if len(parts) > 0 else "", "date": parts[1] if len(parts) > 1 else "", "subject": parts[2] if len(parts) > 2 else ""}
    lparts = latest.split("|", 2) if latest else []
    latest_obj = {"hash": lparts[0], "date": lparts[1] if len(lparts) > 1 else "", "subject": lparts[2] if len(lparts) > 2 else ""} if lparts else None

    return jsonify({
        "ok": True,
        "fetch_ok": ok_fetch,
        "fetch_error": None if ok_fetch else (fetch_out or "").strip()[-400:],
        "has_upstream": up_ok,
        "behind": behind,
        "ahead": ahead,
        "up_to_date": (behind == 0),
        "dirty": len(dirty_files) > 0,
        "dirty_files": [f[3:] if len(f) > 3 else f for f in dirty_files][:50],
        "dirty_count": len(dirty_files),
        "current": current,
        "latest": latest_obj,
    }), 200

@app.route("/api/app/update", methods=["POST"])
def app_update():
    if _blocked_cross_origin():
        return jsonify({"error": "Cross-origin request blocked"}), 403
    if not _is_git_repo():
        return jsonify({"error": "This install is not a git checkout, so it can't self-update."}), 400

    # 1) Never run over local edits.
    _, dirty_out = _run("git status --porcelain", timeout=30)
    dirty_files = [l[3:] if len(l) > 3 else l for l in (dirty_out or "").splitlines() if l.strip()]
    if dirty_files:
        return jsonify({
            "error": "You have local changes in this folder. Commit or discard them before updating — the updater will not overwrite your work.",
            "dirty": True, "dirty_files": dirty_files[:50], "dirty_count": len(dirty_files),
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
    _, new_head = _run('git log -1 --format=%h|%s', timeout=15)

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


# ─────────────────────────────────────────────────────────────────────────────
# Serve the built React frontend (single-server / one-click model).
# In dev you can still run `npm run dev` (Vite proxies /api here); in production
# `npm run build` produces frontend/dist which is served from here.
# ─────────────────────────────────────────────────────────────────────────────
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")

# ---------------------------------------------------------------------------
# Autonomous trading
# ---------------------------------------------------------------------------
# The research floor lives in the browser; the robot lives here. The browser
# publishes an AUDITED strategy, this process trades it. Nothing about the
# credentials is ever returned to the browser.

try:
    import autotrader
    import trading_account as _acct
    AUTOTRADER_OK = True
except Exception as _e:
    autotrader = None
    _acct = None
    AUTOTRADER_OK = False
    print("[AUTO] autotrader unavailable: %s" % _e, flush=True)


@app.route("/api/autonomy/status", methods=["GET"])
def autonomy_status():
    if not AUTOTRADER_OK:
        return jsonify({"available": False, "reason": "autotrader module failed to load"})
    snap = autotrader.snapshot()
    snap["available"] = True
    snap["locked_to"] = _acct.expected_login()
    return jsonify(snap)


@app.route("/api/autonomy/strategy", methods=["POST"])
def autonomy_strategy():
    """The research floor publishes here after Audit has ruled on a strategy.

    A payload whose audit did not pass is still stored - the robot needs to
    know it is blocked and why, so it can say so instead of going quiet."""
    if _blocked_cross_origin():
        return jsonify({"error": "Cross-origin request blocked"}), 403
    if not AUTOTRADER_OK:
        return jsonify({"error": "autotrader unavailable"}), 503
    data = request.get_json(force=True) or {}
    if not data.get("champions"):
        return jsonify({"error": "no champions in payload"}), 400
    saved = autotrader.save_strategy(data)
    return jsonify({"ok": True, "signed_at": saved["signed_at"],
                    "audit_pass": bool((saved.get("audit") or {}).get("pass")),
                    "executable": saved.get("executable", True),
                    "executable_reason": saved.get("executable_reason", "")})


@app.route("/api/autonomy/control", methods=["POST"])
def autonomy_control():
    if _blocked_cross_origin():
        return jsonify({"error": "Cross-origin request blocked"}), 403
    if not AUTOTRADER_OK:
        return jsonify({"error": "autotrader unavailable"}), 503
    data = request.get_json(force=True) or {}
    if "enabled" in data:
        autotrader.STATE["enabled"] = bool(data["enabled"])
        autotrader._log("control", "Robot switched %s from the app."
                        % ("ON" if data["enabled"] else "OFF"))
    if data.get("mode") in ("live", "paper"):
        autotrader.STATE["mode"] = data["mode"]
        autotrader._log("control", "Mode set to %s." % data["mode"])
    if data.get("flatten"):
        autotrader.STATE["enabled"] = False
        autotrader._log("control", "Kill switch: robot disabled by the director.")
    return jsonify({"ok": True, "enabled": autotrader.STATE["enabled"],
                    "mode": autotrader.STATE["mode"]})


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
    if AUTOTRADER_OK:
        autotrader.start()
        print("[AUTO] autonomous trading thread started", flush=True)
    socketio.run(app, host="127.0.0.1", port=5000, debug=True, use_reloader=False)
