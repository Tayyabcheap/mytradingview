"""
Trade Journal Engine for MT5 Deals & Positions
Reconstructs round-trip trades from MT5 deal and order history, classifies exit reasons (TP hit, SL hit, manual close),
and calculates daily, weekly, monthly, and annual statistics.
"""

from __future__ import annotations
import datetime
import math
from typing import Dict, List, Optional, Any
import numpy as np
import pandas as pd

def categorize_symbol(name: str, path: str = "", description: str = "") -> str:
    """Categorize an instrument symbol into TradingView-style categories."""
    p_lower = (path or "").lower()
    n_upper = (name or "").upper()
    d_lower = (description or "").lower()

    # 1. Crypto
    if "crypto" in p_lower or any(c in n_upper for c in ["BTC", "ETH", "SOL", "XRP", "DOGE", "LTC", "BNB", "ADA", "USDT"]):
        return "Crypto"

    # 2. Commodities (Metals & Energies)
    if any(m in p_lower for m in ["metal", "commodit", "energy", "oil", "gas"]) or \
       any(n_upper.startswith(m) for m in ["XAU", "XAG", "XPT", "XPD", "GOLD", "SILVER", "USOIL", "UKOIL", "NGAS", "COPPER"]):
        return "Commodities"

    # 3. Indices
    if any(idx in p_lower for idx in ["index", "indices"]) or \
       any(idx in n_upper for idx in ["US30", "US500", "USTEC", "NAS100", "SPX500", "GER40", "UK100", "JP225", "HK50", "DXY", "VOL"]):
        return "Indices"

    # 4. Stocks / Equities
    if any(stk in p_lower for stk in ["stock", "share", "equity"]):
        return "Stocks"

    # 5. Futures & Bonds
    if "future" in p_lower:
        return "Futures"
    if "bond" in p_lower:
        return "Bonds"

    # 6. Forex (Currencies) - default for standard FX pairs or Cent\\Forex
    if "forex" in p_lower or "currency" in p_lower:
        return "Forex"

    # Fallback heuristics based on typical currency names (EUR, USD, GBP, JPY, AUD, CAD, CHF, NZD)
    currencies = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "HKD", "SGD", "ZAR", "CNH", "SEK", "NOK", "TRY", "MXN"]
    matched_curr = sum(1 for c in currencies if c in n_upper)
    if matched_curr >= 2:
        return "Forex"

    return "Forex"


def parse_mt5_deals_to_trades(deals: list, orders: list = None) -> List[Dict[str, Any]]:
    """
    Pairs MT5 ENTRY_IN (entry=0) and ENTRY_OUT (entry=1) deals by position_id into complete round-trip trades.
    Extracts open/close times, prices, SL/TP hit detection, lot sizes, commission, swap, profit.
    """
    if not deals:
        return []

    # Map orders by order ticket if available to extract SL/TP settings
    order_map = {}
    if orders:
        for o in orders:
            o_dict = o._asdict() if hasattr(o, '_asdict') else dict(o)
            order_map[o_dict.get('ticket')] = o_dict

    # Group deals by position_id
    positions_deals: Dict[int, List[Dict[str, Any]]] = {}
    for d in deals:
        d_dict = d._asdict() if hasattr(d, '_asdict') else dict(d)
        pos_id = d_dict.get('position_id', 0)
        if not pos_id:
            continue
        if pos_id not in positions_deals:
            positions_deals[pos_id] = []
        positions_deals[pos_id].append(d_dict)

    trades = []
    for pos_id, p_deals in positions_deals.items():
        # Sort deals chronologically
        p_deals.sort(key=lambda x: x.get('time_msc', x.get('time', 0)))

        in_deals = [d for d in p_deals if d.get('entry') == 0]  # DEAL_ENTRY_IN
        out_deals = [d for d in p_deals if d.get('entry') == 1] # DEAL_ENTRY_OUT

        if not in_deals:
            continue

        first_in = in_deals[0]
        symbol = first_in.get('symbol', '')
        trade_type = "BUY" if first_in.get('type') == 0 else "SELL"
        volume = float(first_in.get('volume', 0.0))
        open_time = int(first_in.get('time', 0))
        open_price = float(first_in.get('price', 0.0))

        # Check order info for SL and TP if present
        order_info = order_map.get(first_in.get('order'), {})
        sl = float(order_info.get('sl', 0.0) or 0.0)
        tp = float(order_info.get('tp', 0.0) or 0.0)

        # Aggregate total commission, swap, profit
        total_commission = sum(float(d.get('commission', 0.0)) for d in p_deals)
        total_swap = sum(float(d.get('swap', 0.0)) for d in p_deals)
        total_profit = sum(float(d.get('profit', 0.0)) for d in p_deals)

        if out_deals:
            last_out = out_deals[-1]
            close_time = int(last_out.get('time', 0))
            close_price = float(last_out.get('price', 0.0))
            reason = last_out.get('reason', 0)
            comment = (last_out.get('comment') or "") + " " + (first_in.get('comment') or "")

            # Exit Reason detection:
            # reason 4 = DEAL_REASON_SL, reason 5 = DEAL_REASON_TP, reason 3 = EXPERT, reason 0 = CLIENT
            if reason == 5 or "[tp" in comment.lower():
                exit_reason = "TP Hit"
            elif reason == 4 or "[sl" in comment.lower():
                exit_reason = "SL Hit"
            elif "tp" in comment.lower():
                exit_reason = "TP Hit"
            elif "sl" in comment.lower():
                exit_reason = "SL Hit"
            else:
                exit_reason = "Manual Close"

            status = "CLOSED"
            duration_sec = max(0, close_time - open_time)
        else:
            close_time = None
            close_price = None
            exit_reason = "OPEN"
            status = "OPEN"
            duration_sec = max(0, int(datetime.datetime.now().timestamp()) - open_time)

        # Price diff / pips estimate
        pips = 0.0
        if close_price and open_price:
            diff = (close_price - open_price) if trade_type == "BUY" else (open_price - close_price)
            point_mult = 100.0 if ("JPY" in symbol or "XAU" in symbol) else 10000.0
            pips = round(diff * point_mult, 1)

        trades.append({
            "ticket": pos_id,
            "order_id": first_in.get('order'),
            "symbol": symbol,
            "category": categorize_symbol(symbol),
            "type": trade_type,
            "volume": volume,
            "open_time": open_time,
            "open_time_str": datetime.datetime.fromtimestamp(open_time).strftime("%Y-%m-%d %H:%M:%S") if open_time else "",
            "open_price": open_price,
            "close_time": close_time,
            "close_time_str": datetime.datetime.fromtimestamp(close_time).strftime("%Y-%m-%d %H:%M:%S") if close_time else "",
            "close_price": close_price,
            "sl": sl,
            "tp": tp,
            "exit_reason": exit_reason,
            "commission": round(total_commission, 2),
            "swap": round(total_swap, 2),
            "profit": round(total_profit, 2),
            "net_pnl": round(total_profit + total_commission + total_swap, 2),
            "pips": pips,
            "status": status,
            "duration_sec": duration_sec,
            "duration_str": format_duration(duration_sec),
            "comment": (first_in.get('comment') or '').strip()
        })

    # Sort trades descending by open_time (newest first)
    trades.sort(key=lambda x: x['open_time'], reverse=True)
    return trades


def format_duration(seconds: int) -> str:
    """Format seconds into readable human duration string."""
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m"
    hours = minutes // 60
    rem_mins = minutes % 60
    if hours < 24:
        return f"{hours}h {rem_mins}m"
    days = hours // 24
    rem_hours = hours % 24
    return f"{days}d {rem_hours}h"


def calculate_trade_statistics(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Computes comprehensive trading metrics, Sharpe ratio, Profit Factor, Win Rate,
    Daily, Weekly, Monthly, and Annual aggregates.
    """
    closed_trades = [t for t in trades if t.get('status') == 'CLOSED']
    total_trades = len(closed_trades)

    if total_trades == 0:
        return {
            "total_trades": 0,
            "winning_trades": 0,
            "losing_trades": 0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "net_pnl": 0.0,
            "gross_profit": 0.0,
            "gross_loss": 0.0,
            "avg_trade": 0.0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "best_trade": 0.0,
            "worst_trade": 0.0,
            "payoff_ratio": 0.0,
            "sharpe_ratio": 0.0,
            "max_drawdown": 0.0,
            "tp_hits": 0,
            "sl_hits": 0,
            "manual_closes": 0,
            "daily": {},
            "weekly": {},
            "monthly": {},
            "annual": {},
        }

    pnl_list = [t['net_pnl'] for t in closed_trades]
    wins = [p for p in pnl_list if p > 0]
    losses = [p for p in pnl_list if p < 0]
    evens = [p for p in pnl_list if p == 0]

    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    net_pnl = sum(pnl_list)
    win_rate = round((len(wins) / total_trades) * 100.0, 1) if total_trades > 0 else 0.0
    profit_factor = round(gross_profit / (gross_loss + 1e-9), 2) if gross_loss > 0 else (round(gross_profit, 2) if gross_profit > 0 else 0.0)

    avg_win = round(float(np.mean(wins)), 2) if len(wins) > 0 else 0.0
    avg_loss = round(float(np.mean(losses)), 2) if len(losses) > 0 else 0.0
    payoff_ratio = round(abs(avg_win / (avg_loss + 1e-9)), 2) if avg_loss != 0 else 0.0
    avg_trade = round(net_pnl / total_trades, 2)

    best_trade = max(pnl_list) if pnl_list else 0.0
    worst_trade = min(pnl_list) if pnl_list else 0.0

    tp_hits = sum(1 for t in closed_trades if t.get('exit_reason') == 'TP Hit')
    sl_hits = sum(1 for t in closed_trades if t.get('exit_reason') == 'SL Hit')
    manual_closes = sum(1 for t in closed_trades if t.get('exit_reason') == 'Manual Close')

    # Cumulative equity curve & Max Drawdown
    equity_curve = np.cumsum(pnl_list)
    peak = np.maximum.accumulate(equity_curve)
    drawdowns = peak - equity_curve
    max_drawdown = round(float(np.max(drawdowns)), 2) if len(drawdowns) > 0 else 0.0

    # Daily aggregation
    daily_map: Dict[str, Dict[str, Any]] = {}
    weekly_map: Dict[str, Dict[str, Any]] = {}
    monthly_map: Dict[str, Dict[str, Any]] = {}
    annual_map: Dict[str, Dict[str, Any]] = {}

    for t in closed_trades:
        c_time = t.get('close_time') or t.get('open_time')
        dt = datetime.datetime.fromtimestamp(c_time)
        day_key = dt.strftime("%Y-%m-%d")
        week_key = f"{dt.year}-W{dt.isocalendar()[1]:02d}"
        month_key = dt.strftime("%Y-%m")
        year_key = dt.strftime("%Y")

        pnl = t['net_pnl']

        # Daily
        if day_key not in daily_map:
            daily_map[day_key] = {"pnl": 0.0, "trades": 0, "wins": 0, "losses": 0}
        daily_map[day_key]["pnl"] += pnl
        daily_map[day_key]["trades"] += 1
        if pnl > 0: daily_map[day_key]["wins"] += 1
        elif pnl < 0: daily_map[day_key]["losses"] += 1

        # Weekly
        if week_key not in weekly_map:
            weekly_map[week_key] = {"pnl": 0.0, "trades": 0, "wins": 0, "losses": 0}
        weekly_map[week_key]["pnl"] += pnl
        weekly_map[week_key]["trades"] += 1
        if pnl > 0: weekly_map[week_key]["wins"] += 1
        elif pnl < 0: weekly_map[week_key]["losses"] += 1

        # Monthly
        if month_key not in monthly_map:
            monthly_map[month_key] = {"pnl": 0.0, "trades": 0, "wins": 0, "losses": 0}
        monthly_map[month_key]["pnl"] += pnl
        monthly_map[month_key]["trades"] += 1
        if pnl > 0: monthly_map[month_key]["wins"] += 1
        elif pnl < 0: monthly_map[month_key]["losses"] += 1

        # Annual
        if year_key not in annual_map:
            annual_map[year_key] = {"pnl": 0.0, "trades": 0, "wins": 0, "losses": 0, "months": {}}
        annual_map[year_key]["pnl"] += pnl
        annual_map[year_key]["trades"] += 1
        if pnl > 0: annual_map[year_key]["wins"] += 1
        elif pnl < 0: annual_map[year_key]["losses"] += 1
        m_short = dt.strftime("%b")
        if m_short not in annual_map[year_key]["months"]:
            annual_map[year_key]["months"][m_short] = 0.0
        annual_map[year_key]["months"][m_short] += pnl

    # Clean float rounding on map aggregates
    for d_k, d_v in daily_map.items():
        d_v["pnl"] = round(d_v["pnl"], 2)
        d_v["win_rate"] = round((d_v["wins"] / d_v["trades"]) * 100, 1) if d_v["trades"] else 0.0

    for w_k, w_v in weekly_map.items():
        w_v["pnl"] = round(w_v["pnl"], 2)
        w_v["win_rate"] = round((w_v["wins"] / w_v["trades"]) * 100, 1) if w_v["trades"] else 0.0

    for m_k, m_v in monthly_map.items():
        m_v["pnl"] = round(m_v["pnl"], 2)
        m_v["win_rate"] = round((m_v["wins"] / m_v["trades"]) * 100, 1) if m_v["trades"] else 0.0

    for y_k, y_v in annual_map.items():
        y_v["pnl"] = round(y_v["pnl"], 2)
        y_v["win_rate"] = round((y_v["wins"] / y_v["trades"]) * 100, 1) if y_v["trades"] else 0.0
        for m_name in y_v["months"]:
            y_v["months"][m_name] = round(y_v["months"][m_name], 2)

    # Annualised Sharpe ratio on daily P&L
    daily_pnls = np.array([v["pnl"] for v in daily_map.values()])
    if len(daily_pnls) >= 3 and np.std(daily_pnls) > 0:
        sharpe_val = (np.mean(daily_pnls) / np.std(daily_pnls)) * math.sqrt(252)
        sharpe_ratio = round(float(sharpe_val), 2)
    else:
        sharpe_ratio = 0.0

    return {
        "total_trades": total_trades,
        "winning_trades": len(wins),
        "losing_trades": len(losses),
        "even_trades": len(evens),
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "net_pnl": round(net_pnl, 2),
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "avg_trade": avg_trade,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "payoff_ratio": payoff_ratio,
        "best_trade": round(best_trade, 2),
        "worst_trade": round(worst_trade, 2),
        "sharpe_ratio": sharpe_ratio,
        "max_drawdown": max_drawdown,
        "tp_hits": tp_hits,
        "sl_hits": sl_hits,
        "manual_closes": manual_closes,
        "daily": daily_map,
        "weekly": weekly_map,
        "monthly": monthly_map,
        "annual": annual_map,
    }
