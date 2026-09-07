"""
autotrader.py - the desk actually trading.
==========================================
Runs in a background thread inside the Flask app. Every few seconds it asks
one question: is there any reason NOT to trade? Only when every answer is no
does it look for a setup.

The gates, in order:
  1. Is the robot switched on at all?
  2. Is MetaTrader on the ONE account this robot is locked to, and is it a
     demo account?  (trading_account.verify)
  3. Is the market open, and is it not Friday evening?  (market_clock)
  4. Has the research floor published a strategy that AUDIT SIGNED OFF?
  5. Is that sign-off less than 24 hours old?
  6. Has today's loss stop or trade cap been hit?  (Legal)
  7. Only then: is there a setup on the last closed bar?

Any single "no" and it does nothing and says why. There is no path through
this file that opens a position while audit is blocking.
"""

from __future__ import annotations
import datetime as dt
import json
import os
import threading
import time
import traceback
from typing import Dict, List, Optional

import market_clock as clock
import strategy_runtime as sr
import trading_account as acct

try:
    import MetaTrader5 as mt5
    MT5_OK = True
except Exception:
    mt5 = None
    MT5_OK = False

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
STRATEGY_PATH = os.path.join(_ROOT, "approved_strategy.json")
STATE_PATH = os.path.join(_ROOT, "autotrader_state.json")

MAGIC = 4726690
SIGNOFF_MAX_AGE_SEC = 24 * 3600
POLL_SEC = 5
GOLD_HARD_LOT_CAP = 1.0

_lock = threading.RLock()
_thread: Optional[threading.Thread] = None
_stop = threading.Event()
_track: Dict[int, Dict] = {}

STATE: Dict = {
    "enabled": True, "mode": "live", "status": "starting", "reason": "",
    "gates": {}, "account": {}, "market": {}, "strategy": None, "position": None,
    "today": {"date": "", "trades": 0, "realised": 0.0, "start_equity": 0.0},
    "log": [], "last_bar": 0, "last_tick": 0,
    "book": [], "positions": [], "last_bar_by_slot": {},
}


def _log(kind: str, msg: str, extra: Optional[dict] = None):
    row = {"t": int(time.time() * 1000), "kind": kind, "msg": msg}
    if extra:
        row.update(extra)
    STATE["log"].insert(0, row)
    del STATE["log"][300:]
    print("[AUTO] %s: %s" % (kind, msg), flush=True)


def _save_state():
    try:
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump({"enabled": STATE["enabled"], "mode": STATE["mode"],
                       "today": STATE["today"], "log": STATE["log"][:80]}, f)
    except Exception:
        pass


def _load_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            d = json.load(f)
        STATE["enabled"] = bool(d.get("enabled", True))
        STATE["mode"] = d.get("mode", "live")
        STATE["today"] = d.get("today", STATE["today"])
        STATE["log"] = d.get("log", [])
    except Exception:
        pass


def load_strategy() -> Optional[dict]:
    try:
        with open(STRATEGY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def save_strategy(payload: dict) -> dict:
    payload = dict(payload)
    cfg = payload.get("champions") or sr.DEFAULT_GENOMES
    # Store it either way, and stamp whether this trader can run it.
    # Refusing to write it would leave the robot with nothing to point at, so
    # it would report "the floor has not published anything yet" - which is
    # false, and hides the real reason. The whole point of this file is that
    # it says why it is not trading rather than going quiet, so the honest
    # move is to record it and mark it unrunnable.
    can_run, why = sr.can_execute(cfg)
    payload["executable"] = bool(can_run)
    payload["executable_reason"] = "" if can_run else why
    payload["signed_at"] = int(time.time())
    with open(STRATEGY_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return payload


def _tf_const(tf: str):
    return {"1M": mt5.TIMEFRAME_M1, "5M": mt5.TIMEFRAME_M5, "15M": mt5.TIMEFRAME_M15,
            "30M": mt5.TIMEFRAME_M30, "1H": mt5.TIMEFRAME_H1, "4H": mt5.TIMEFRAME_H4,
            "1D": mt5.TIMEFRAME_D1}.get(tf, mt5.TIMEFRAME_H1)


def _tf_seconds(tf: str) -> int:
    return {"1M": 60, "5M": 300, "15M": 900, "30M": 1800,
            "1H": 3600, "4H": 14400, "1D": 86400}.get(tf, 3600)


def _fetch_bars(symbol: str, tf: str, count: int) -> Optional[sr.Bars]:
    rates = mt5.copy_rates_from_pos(symbol, _tf_const(tf), 0, count)
    if rates is None or len(rates) < 60:
        return None
    rows = rates[:-1]                      # drop the bar still forming
    return sr.Bars(
        t=[int(r["time"]) * 1000 for r in rows],
        o=[float(r["open"]) for r in rows], h=[float(r["high"]) for r in rows],
        l=[float(r["low"]) for r in rows], c=[float(r["close"]) for r in rows])


def _our_positions(symbol: str) -> List:
    return [p for p in (mt5.positions_get(symbol=symbol) or []) if int(p.magic) == MAGIC]


def _roll_day(equity: float):
    today = dt.datetime.utcnow().strftime("%Y-%m-%d")
    if STATE["today"].get("date") != today:
        STATE["today"] = {"date": today, "trades": 0, "realised": 0.0, "start_equity": equity}
        _log("day", "New trading day %s. Starting equity %.2f." % (today, equity))


def _refresh_today():
    """Recount today from the broker's own record, never from memory."""
    start = dt.datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    deals = mt5.history_deals_get(start, dt.datetime.utcnow() + dt.timedelta(minutes=5))
    trades, realised, last_loss = 0, 0.0, 0
    for d in deals or []:
        if int(getattr(d, "magic", 0)) != MAGIC:
            continue
        if int(d.entry) == 0:
            trades += 1
        else:
            pnl = float(d.profit) + float(d.commission) + float(d.swap)
            realised += pnl
            if pnl < 0:
                last_loss = max(last_loss, int(d.time))
    STATE["today"]["trades"] = trades
    STATE["today"]["realised"] = round(realised, 2)
    STATE["today"]["last_loss_time"] = last_loss


def _send(symbol: str, direction: int, lots: float, sl: float, tp: float, comment: str):
    info, tick = mt5.symbol_info(symbol), mt5.symbol_info_tick(symbol)
    if info is None or tick is None:
        return None, "no quote"
    price = float(tick.ask) if direction > 0 else float(tick.bid)
    filling = mt5.ORDER_FILLING_IOC
    for mode in (mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN):
        if info.filling_mode & (mode + 1):
            filling = mode
            break
    res = mt5.order_send({
        "action": mt5.TRADE_ACTION_DEAL, "symbol": symbol, "volume": float(lots),
        "type": mt5.ORDER_TYPE_BUY if direction > 0 else mt5.ORDER_TYPE_SELL,
        "price": price, "sl": float(sl), "tp": float(tp), "deviation": 30,
        "magic": MAGIC, "comment": comment[:31],
        "type_time": mt5.ORDER_TIME_GTC, "type_filling": filling})
    if res is None:
        return None, "order_send returned None: %s" % (mt5.last_error(),)
    if res.retcode != mt5.TRADE_RETCODE_DONE:
        return None, "rejected %s: %s" % (res.retcode, res.comment)
    return res, ""


def _close(pos, volume: Optional[float] = None, why: str = "close"):
    tick = mt5.symbol_info_tick(pos.symbol)
    if tick is None:
        return False, "no quote"
    is_buy = int(pos.type) == mt5.POSITION_TYPE_BUY
    res = mt5.order_send({
        "action": mt5.TRADE_ACTION_DEAL, "symbol": pos.symbol,
        "volume": float(volume or pos.volume),
        "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
        "position": int(pos.ticket),
        "price": float(tick.bid) if is_buy else float(tick.ask),
        "deviation": 30, "magic": MAGIC, "comment": why[:31],
        "type_time": mt5.ORDER_TIME_GTC, "type_filling": mt5.ORDER_FILLING_IOC})
    ok = res is not None and res.retcode == mt5.TRADE_RETCODE_DONE
    return ok, ("" if ok else "%s" % (getattr(res, "comment", mt5.last_error()),))


def _modify_sl(pos, sl: float) -> bool:
    res = mt5.order_send({"action": mt5.TRADE_ACTION_SLTP, "symbol": pos.symbol,
                          "position": int(pos.ticket), "sl": float(sl), "tp": float(pos.tp)})
    return res is not None and res.retcode == mt5.TRADE_RETCODE_DONE


def tick():
    STATE["last_tick"] = int(time.time() * 1000)
    gates = {}
    STATE["gates"] = gates

    if not MT5_OK:
        STATE["status"], STATE["reason"] = "unavailable", "The MetaTrader5 python package is not installed."
        return
    if not STATE["enabled"]:
        STATE["status"], STATE["reason"] = "off", "Switched off from the app."
        gates["enabled"] = False
        return
    gates["enabled"] = True

    st = acct.connect()
    STATE["account"] = st.as_dict()
    gates["account"] = st.ok
    if not st.ok:
        STATE["status"], STATE["reason"] = "blocked", st.reason
        return

    _roll_day(st.equity)

    strat = load_strategy()
    gates["strategy"] = bool(strat)
    if not strat:
        STATE["status"], STATE["reason"] = "waiting", "The research floor has not published a strategy yet."
        return

    # ---- the book -------------------------------------------------------
    # One champion is a book of one at full weight. Keeping a single code
    # path means the well-tested single-strategy behaviour IS the book
    # behaviour, rather than a second implementation that can drift.
    slots = build_book(strat)
    STATE["book"] = [{"id": b["id"], "symbol": b["symbol"], "timeframe": b["timeframe"],
                      "weight": round(b["weight"], 4), "executable": b["executable"],
                      "reason": b.get("reason", "")} for b in slots]

    audit_pass = bool((strat.get("audit") or {}).get("pass"))
    age = time.time() - float(strat.get("signed_at") or 0)
    gates["audit_pass"] = audit_pass
    gates["signoff_fresh"] = age <= SIGNOFF_MAX_AGE_SEC
    runnable = [b for b in slots if b["executable"]]
    gates["executable"] = bool(runnable)
    STATE["strategy"] = {
        "symbol": slots[0]["symbol"] if slots else "-",
        "timeframe": slots[0]["timeframe"] if slots else "-",
        "audit_pass": audit_pass,
        "signed_at": strat.get("signed_at"), "age_hours": round(age / 3600, 1),
        "generation": strat.get("generation"), "summary": strat.get("summary") or [],
        "metrics": strat.get("metrics") or {},
        "slots": len(slots), "runnable": len(runnable),
        "executable": bool(runnable),
        "executable_reason": "" if runnable else (slots[0].get("reason", "") if slots else ""),
        "blockers": (strat.get("audit") or {}).get("blockers") or []}

    # ---- market state, for the book as a whole ---------------------------
    # The weekend rule is the firm's, not the symbol's: Haider asked the desk
    # to sleep Saturday and Sunday. Per-symbol tradability and quote
    # freshness are still checked inside each slot below.
    ms = clock.market_state()
    STATE["market"] = dict(ms.__dict__)
    gates["market_open"] = ms.open

    # ---- open positions, across every symbol in the book ------------------
    open_all = []
    for b in slots:
        open_all.extend(_our_positions(b["symbol"]))
    STATE["position"] = None
    STATE["positions"] = [
        {"ticket": int(p.ticket), "symbol": p.symbol,
         "type": "BUY" if int(p.type) == mt5.POSITION_TYPE_BUY else "SELL",
         "volume": float(p.volume), "open": float(p.price_open),
         "sl": float(p.sl), "tp": float(p.tp),
         "profit": float(p.profit), "opened": int(p.time)} for p in open_all]
    if STATE["positions"]:
        STATE["position"] = STATE["positions"][0]

    if ms.force_flat and open_all:
        for p in open_all:
            ok, err = _close(p, why="weekend flat")
            _log("flat", ("Closed #%s before the weekend." % p.ticket) if ok else ("Weekend close failed: %s" % err))
        STATE["status"], STATE["reason"] = "weekend", ms.reason
        return

    if not ms.open and not open_all:
        STATE["status"] = "asleep" if ms.state == "weekend" else "closed"
        STATE["reason"] = ms.reason
        return

    # ---- manage what is already open, always -----------------------------
    # An open trade is managed to its exit even while Audit blocks new
    # entries. Abandoning a live position because a check failed is worse
    # than the check failing.
    managed = 0
    for b in slots:
        for p in _our_positions(b["symbol"]):
            bars = _fetch_bars(b["symbol"], b["timeframe"],
                               max(600, sr.warmup_bars(b["cfg"]) + 260))
            if bars is None:
                continue
            _manage(p, bars, sr.Indicators(bars, b["cfg"]), b["cfg"], b["timeframe"])
            managed += 1

    if not runnable:
        why = slots[0].get("reason", "no runnable strategy") if slots else "no strategy"
        STATE["status"], STATE["reason"] = "blocked", (
            "Nothing in the book can be run by this trader: %s. The floor keeps "
            "researching it; nothing is traded until a discipline this trader can "
            "reproduce is signed off." % why)
        return
    if not audit_pass:
        blockers = (strat.get("audit") or {}).get("blockers") or []
        STATE["status"] = "blocked"
        STATE["reason"] = "Audit is blocking the desk: %s" % (blockers[0] if blockers else "no sign-off.")
        return
    if age > SIGNOFF_MAX_AGE_SEC:
        STATE["status"] = "stale"
        STATE["reason"] = ("The last audit sign-off is %.0f hours old. Open MyBrains so the floor "
                           "can re-check the strategy against current data." % (age / 3600))
        return
    if not ms.allow_new:
        STATE["status"], STATE["reason"] = "winddown", ms.reason
        return

    # ---- Legal's limits belong to the FIRM, not to each strategy ----------
    # Five strategies each allowed six trades a day is thirty trades a day
    # against a cap of six. The cap, the daily loss stop and the cool-down
    # are all counted once, across the whole book.
    _refresh_today()
    lead = runnable[0]["cfg"]
    legal, fin = lead["legal"], lead["finance"]
    max_loss_pct = float(legal["maxDailyLossR"]) * float(fin["riskPct"])
    start_eq = STATE["today"]["start_equity"] or st.equity
    loss_pct = (-STATE["today"]["realised"] / start_eq * 100.0) if start_eq else 0.0
    gates["daily_loss"] = loss_pct < max_loss_pct
    if loss_pct >= max_loss_pct:
        STATE["status"] = "stopped"
        STATE["reason"] = ("Legal's daily loss stop has been hit - down %.2f%% today against a limit "
                           "of %.2f%%. No more trades until tomorrow." % (loss_pct, max_loss_pct))
        return
    gates["trade_cap"] = STATE["today"]["trades"] < int(legal["maxTradesDay"])
    if not gates["trade_cap"]:
        STATE["status"] = "stopped"
        STATE["reason"] = "Legal's cap of %d trades a day has been reached across the whole book." % int(legal["maxTradesDay"])
        return
    cooldown = int(legal["cooldownBars"]) * _tf_seconds(runnable[0]["timeframe"])
    last_loss = STATE["today"].get("last_loss_time", 0)
    if cooldown and last_loss and (time.time() - last_loss) < cooldown:
        left = int((cooldown - (time.time() - last_loss)) / 60)
        STATE["status"] = "cooling"
        STATE["reason"] = "Cooling off after a loss for another %d minutes, as Legal requires." % left
        return

    # ---- work each slot ---------------------------------------------------
    watching = []
    opened = 0
    for b in runnable:
        if STATE["today"]["trades"] >= int(legal["maxTradesDay"]):
            break                                   # the firm's cap, re-checked each slot
        r = _work_slot(b, st, ms, strat)
        if r == "opened":
            opened += 1
        elif r:
            watching.append("%s: %s" % (b["symbol"], r))

    if opened:
        STATE["status"], STATE["reason"] = "in-trade", "Opened %d trade%s from the book." % (opened, "" if opened == 1 else "s")
    elif open_all:
        STATE["status"], STATE["reason"] = "in-trade", "Managing %d open position%s." % (len(open_all), "" if len(open_all) == 1 else "s")
    else:
        STATE["status"] = "watching"
        STATE["reason"] = (watching[0] if watching else "Waiting for a setup across %d strategies." % len(runnable))


def build_book(strat: dict) -> List[dict]:
    """Turn a published payload into the slots this trader will work.

    A payload with a `book` gives several weighted strategies. A payload with
    only `champions` gives one at full weight - the same thing with k=1.
    Weights are normalised so they sum to 1, which is what keeps total risk
    across the book equal to Finance's risk per trade rather than a multiple
    of it. See RISK NOTE below.
    """
    rows = strat.get("book") or []
    if not rows:
        cfg = strat.get("champions") or sr.DEFAULT_GENOMES
        rows = [{"id": "champion", "symbol": strat.get("symbol") or "XAUUSDc",
                 "timeframe": strat.get("timeframe") or "1H", "cfg": cfg, "weight": 1.0}]

    slots = []
    for r in rows:
        cfg = r.get("cfg") or r.get("champions")
        if not cfg or not isinstance(cfg, dict) or "science" not in cfg:
            continue
        ok, why = sr.can_execute(cfg)
        slots.append({
            "id": str(r.get("id") or "s%d" % len(slots)),
            "symbol": r.get("symbol") or strat.get("symbol") or "XAUUSDc",
            "timeframe": r.get("timeframe") or strat.get("timeframe") or "1H",
            "cfg": cfg, "weight": max(0.0, float(r.get("weight") or 0.0)),
            "executable": ok, "reason": "" if ok else why})

    # RISK NOTE. Weights are normalised over the RUNNABLE slots only, so
    # dropping a research-only strategy does not silently leave the book
    # under-invested - but the total never exceeds 1.0, so the book cannot
    # risk more than one strategy would have. This is deliberately more
    # conservative than the sqrt(k) scaling the portfolio theory allows:
    # get the plumbing right first, then let the desk earn the leverage as
    # a separate, audited decision.
    tot = sum(b["weight"] for b in slots if b["executable"])
    if tot > 0:
        for b in slots:
            b["weight"] = (b["weight"] / tot) if b["executable"] else 0.0
    else:
        run = [b for b in slots if b["executable"]]
        for b in slots:
            b["weight"] = (1.0 / len(run)) if (b["executable"] and run) else 0.0
    return slots


def _work_slot(b: dict, st, ms, strat: dict) -> str:
    """One strategy in the book. Returns 'opened', or why it did not."""
    symbol, tf, cfg = b["symbol"], b["timeframe"], b["cfg"]
    mt5.symbol_select(symbol, True)
    sinfo, stick = mt5.symbol_info(symbol), mt5.symbol_info_tick(symbol)
    if sinfo is None or stick is None:
        return "no quote from the broker"
    if sinfo.trade_mode != mt5.SYMBOL_TRADE_MODE_FULL:
        return "the broker has this symbol closed"
    if (time.time() - float(stick.time)) > clock.MAX_QUOTE_AGE_SEC:
        return "no fresh quote"

    if _our_positions(symbol):
        return ""                                   # already in this one; managed above

    bars = _fetch_bars(symbol, tf, max(600, sr.warmup_bars(cfg) + 260))
    if bars is None:
        return "not enough %s history yet" % tf
    ind = sr.Indicators(bars, cfg)

    last_bar = bars.t[-1]
    seen = STATE.setdefault("last_bar_by_slot", {})
    if seen.get(b["id"]) == last_bar:
        return ""                                   # already judged this closed bar
    seen[b["id"]] = last_bar

    d = sr.decide(bars, cfg, ind)
    if d.action != "enter":
        return d.reason

    # Finance's risk, split by the portfolio's weight. The weights sum to 1,
    # so the whole book risks what one strategy used to.
    fin = cfg["finance"]
    risk_pct = float(fin["riskPct"]) * float(b["weight"])
    if risk_pct <= 0:
        return "no weight allocated"

    is_gold = "XAU" in symbol.upper() or "GOLD" in symbol.upper()
    lots = sr.position_size(
        equity=st.equity, risk_pct=risk_pct, stop_distance=d.stop_distance,
        tick_value=float(sinfo.trade_tick_value), tick_size=float(sinfo.trade_tick_size),
        vol_min=float(sinfo.volume_min), vol_max=float(sinfo.volume_max),
        vol_step=float(sinfo.volume_step),
        hard_cap=GOLD_HARD_LOT_CAP if is_gold else float(sinfo.volume_max))
    if lots <= 0:
        return ("a setup fired, but at %.2f%% of the account this stop is too wide to size"
                % risk_pct)

    price = float(stick.ask) if d.direction > 0 else float(stick.bid)
    sl = price - d.direction * d.stop_distance
    tp = price + d.direction * d.stop_distance * d.rr
    side = "BUY" if d.direction > 0 else "SELL"

    if STATE["mode"] == "paper":
        _log("paper", "PAPER %s %s %s @ %.5f sl %.5f tp %.5f (weight %.0f%%)"
             % (side, lots, symbol, price, sl, tp, b["weight"] * 100),
             {"side": side, "lots": lots, "price": price, "sl": sl, "tp": tp, "symbol": symbol})
        return "paper mode - recorded a %s it would have taken" % side

    res, err = _send(symbol, d.direction, lots, sl, tp,
                     "MyBrains g%s %s" % (strat.get("generation", 0), b["id"]))
    if res is None:
        _log("error", "Order rejected on %s: %s" % (symbol, err))
        return "order rejected: %s" % err
    _track[int(res.order)] = {"extreme": price, "partial_done": False, "entry_bar": last_bar}
    _log("entry", "%s %s %s at %.5f - stop %.5f, target %.5f (%.0f%% of the book)"
         % (side, lots, symbol, float(res.price), sl, tp, b["weight"] * 100),
         {"side": side, "lots": lots, "price": float(res.price), "sl": sl, "tp": tp, "symbol": symbol})
    return "opened"


def _manage(pos, bars: sr.Bars, ind: sr.Indicators, cfg, tf: str):
    """Investment's rules applied live: scale out, breakeven, trail, time stop."""
    inv, M = cfg["investment"], cfg["math"]
    is_buy = int(pos.type) == mt5.POSITION_TYPE_BUY
    direction = 1 if is_buy else -1
    tick_ = mt5.symbol_info_tick(pos.symbol)
    if tick_ is None:
        return
    px = float(tick_.bid) if is_buy else float(tick_.ask)
    entry = float(pos.price_open)
    risk = abs(entry - float(pos.sl)) if pos.sl else M["slAtr"] * ind.atr[-1]
    if risk <= 0:
        return

    tr = _track.setdefault(int(pos.ticket),
                           {"extreme": entry, "partial_done": False, "entry_bar": bars.t[-1]})
    tr["extreme"] = max(tr["extreme"], px) if is_buy else min(tr["extreme"], px)
    mfe_r = ((tr["extreme"] - entry) / risk) * direction

    if inv["usePartial"] and not tr["partial_done"] and mfe_r >= float(inv["partialAtR"]):
        info = mt5.symbol_info(pos.symbol)
        step = float(info.volume_step) if info else 0.01
        part = max(step, round((float(pos.volume) * float(inv["partialFrac"])) / step) * step)
        if part < float(pos.volume):
            ok, err = _close(pos, part, "scale out")
            if ok:
                tr["partial_done"] = True
                _modify_sl(pos, entry)
                _log("scale", "Took %s lots off #%s at %.2fR and moved the stop to breakeven."
                     % (part, pos.ticket, mfe_r))

    if inv["useTrail"] and mfe_r >= float(inv["trailAtR"]):
        cand = tr["extreme"] - direction * float(inv["trailAtr"]) * ind.atr[-1]
        better = cand > float(pos.sl) if is_buy else cand < float(pos.sl)
        if better and abs(cand - float(pos.sl)) > (ind.atr[-1] * 0.05):
            if _modify_sl(pos, cand):
                _log("trail", "Trailed the stop on #%s to %.3f (%.2fR open)." % (pos.ticket, cand, mfe_r))

    held = (bars.t[-1] - tr.get("entry_bar", bars.t[-1])) / 1000.0 / _tf_seconds(tf)
    if held >= float(M["maxHold"]):
        ok, err = _close(pos, why="time stop")
        _log("exit", ("Closed #%s on the %d-bar time stop." % (pos.ticket, int(M["maxHold"])))
             if ok else ("Time-stop close failed: %s" % err))


def _loop():
    _load_state()
    _log("boot", "Autotrader thread started.")
    while not _stop.is_set():
        try:
            with _lock:
                tick()
        except Exception as e:
            STATE["status"] = "error"
            STATE["reason"] = "%s: %s" % (type(e).__name__, e)
            _log("error", STATE["reason"])
            traceback.print_exc()
        _save_state()
        _stop.wait(POLL_SEC)


def start():
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="autotrader", daemon=True)
    _thread.start()


def snapshot() -> dict:
    d = {k: v for k, v in STATE.items() if k not in ("log", "last_bar_by_slot")}
    d["log"] = STATE["log"][:60]
    return d
