# TradingView-clone: fixes applied (Aug 2026)

All changes are in `frontend/src/App.jsx`, `frontend/src/components/KLineChartArea.jsx`,
`frontend/src/components/FlyoutToolbar.jsx`, and `src/app.py`.
Backups: `frontend/src/components/_backup_<date>/` and `src/app.py.bak`.

## What was broken → fixed

| # | Feature | Before | After |
|---|---------|--------|-------|
| 1 | Live chart | Loaded once, never ticked | Polls `/api/history?count=2` every 2s via klinecharts `subscribeBar`; forming candle ticks, new bars roll on MT5's own timestamps |
| 2 | Alerts | Never fired (no live price) | Fire on live ticks now that price updates every 2s |
| 3 | Bar Replay | UI only; did nothing | Seeds a slice + steps bars through the live callback; speed control works; live feed pauses during replay |
| 4 | Persistence | Everything reset on reload | symbol, timeframe, chart type, indicators, chart settings, alerts saved to localStorage |
| 5 | Drawing toolbar | ~20 tools aliased to wrong overlays (Gann→rect, Cypher→xabcd, etc.) | Only real, distinct overlays listed; added Circle + Tag |
| 6 | History scroll | Hard wall at 1500 bars | Scroll left loads older bars in 500-bar pages via `/api/history?to=` + `copy_rates_range` |
| 7 | Symbol search | List dump, no search | Autofocused filter box (name + description) |
| 8 | Watchlist | Static, prices `---` | Live quotes via `/api/quotes`, green/red by tick direction |
| 9 | Drawings | Vanished on reload | Persisted per-symbol; restored on symbol load |
| 10 | Keyboard shortcuts | Toolbar showed hints that did nothing | Ctrl+K search; Alt+T/H/J/V/F tools; Alt+Shift+R rect; Esc closes menus |

Also: added `flask-socketio` and `ta` to `requirements.txt` (imported by app.py, were missing).

## Test on Windows (MT5 running + logged in)

```
pip install -r requirements.txt
START_TRADE_WITH_RAKHI.bat        # backend
cd frontend && npm run dev        # frontend
```

1. **Live** — during market hours, last candle ticks + price tag updates every ~2s.
2. **Alerts** — set one just above price; it fires within seconds of crossing.
3. **Replay** — enter → play → candles advance; change speed; Exit restores live.
4. **Persistence** — add an indicator, reload; it's still there.
5. **History** — scroll hard left; older bars keep loading. *(Watch here first — MT5
   timezone quirks are the likeliest bug in the paging window math.)*
6. **Symbol search** — Ctrl+K, type "EUR" / "gold"; list filters.
7. **Watchlist** — prices tick red/green while market is open.
8. **Drawings** — draw a trendline, reload; it comes back. Alt+T draws a trendline.

## Deliberately NOT done (with reasons)

- **True WebSocket streaming** — server runs on socket.io but emits nothing. Upgrading
  needs `socket.io-client` + an `npm install`, which risks corrupting the Windows
  `node_modules` when run from the Linux bridge. 2s polling is genuinely live; do this
  only if you want sub-second ticks.
- **Log/percent price scale** — klinecharts v10 `createYAxis` duplicates the axis unless
  given the existing axis id, which has no public getter. Would likely render a broken
  double-axis; skipped rather than ship blind.

## Note

These frontend changes were syntax-verified (Babel parse) and checked against the
installed klinecharts v10.0.2 API, but could not be run on the Linux bridge (Windows
native bindings). Runtime behavior is confirmed only once you run it on Windows.

---

# Gold Scalper Pro — indicator + backtest (added later)

- **Indicator**: Indicators → Strategies → "Gold Scalper Pro". Plots EMA 21/50,
  BUY/SELL signals (EMA cross + RSI band + 08–12 session), ATR SL/TP.
- **Backend endpoint** (`src/app.py`) connects to MT5 and backtests it:
  `GET /api/backtest/gold_scalper?symbol=XAUUSDc&timeframe=1H&bars=8000&utc_offset=-3`
  Core logic in `src/gold_scalper_bt.py` (shared with the CLI tool).
- **In-app**: top-bar **Backtest** button → modal → Run (set your broker's UTC
  offset first, e.g. -3 for a GMT+3 server) → real stats.
- **CLI** (`tools/backtest_gold_scalper.py`) for the same numbers in a terminal:
  `python tools/backtest_gold_scalper.py --mt5 XAUUSDc --tf H1 --bars 8000 --utc-offset -3`

To get real performance: start MT5 (logged in) + the backend, open the app,
click **Backtest**, set the offset, Run. Paste the numbers back for interpretation.

---

# One-click app + Pine Script editor (added later)

## One-click start/stop
- The app is now a **single server**: Flask serves the built React UI (`src/app.py`
  serves `frontend/dist` with SPA fallback). API calls are relative; `vite.config.js`
  proxies `/api` in dev.
- **START.bat** (a.k.a start.bat): installs deps if missing, builds the frontend on
  first run, starts one server, waits for it, opens http://127.0.0.1:5000.
- **STOP.bat** (a.k.a stop.bat): stops the server by port, robustly.
- First run is slower (it builds). After that it's instant.

## Pine Script editor (TradingView-style)
- Top-bar **Pine** button → editor modal. Paste a Pine v5/v6 script → **Add to Chart**.
- Engine: `frontend/src/components/pineEngine.js` (a Pine SUBSET interpreter).
- **Supported**: inputs (defaults), assignments (= and :=), if/else, close/open/high/low/
  hl2/hlc3/ohlc4/volume/bar_index, ta.ema/sma/rma/wma/rsi/atr/tr/highest/lowest/change/
  mom/stdev/crossover/crossunder/cross, math.*, operators, ternary, x[n] history,
  plot(), plotshape()/plotchar()/plotarrow(), hline(), strategy.entry (→ BUY/SELL),
  color.*/color.new(), overlay=true/false (false → sub-pane).
- **NOT supported** (skipped with a warning, script still runs): for/while loops, arrays,
  user functions (=>), request.security / multi-timeframe, tables, line/box/label objects,
  switch, deep-nested ifs. This is a pragmatic subset, not the full Pine language.
- Scripts persist per browser (localStorage) and re-run on reload.

---

# Usage-feedback fixes (batch)

Bugs found & fixed:
- **Dashboard blank** — `DashboardTab.jsx` used `<ArrowRight>` without importing it → runtime crash. Fixed the import.
- **Alerts never fired** — a refactor left `handlePriceUpdate` only setting price, with no evaluation. Re-added firing (now evaluates every ~700ms tick).
- **Pine "Add to Chart" crashed** — `registerPineScript(pineSource)` was called with one arg expecting a return value; rewired to the working `pineMeta` + PINE-indicator flow.

Features added:
- **Drawings persist in a backend store** (`src/store.py` JSON file + `/api/drawings`). Survive app close / laptop restart / browser-data clear until you delete them. localStorage is the offline fallback.
- **Faster price** — fast `/api/quote` tick poll (~700ms) for price + forming candle; slower 3s bar poll for new-candle rollover.
- **Watchlist** — search / add / remove, persisted (`/api/watchlist`).
- **Drawing edit toolbar** — select any drawing to get a floating colour / line-width / delete toolbar; style changes persist too.
- **Line-menu previews** — each drawing tool shows a sample-line icon.
- **Tab reordering** — drag workspace tabs left/right.
- **Richer alerts** — alert name, Crossing / Crossing-Up / Crossing-Down / ≥ / ≤, Only-Once vs Every-Time trigger, optional expiry; fires a toast + logs.

Still open / your call:
- Pip convention 0.01 vs 0.10 (execution panel & journal vs config/backtester) — unchanged, your decision.
- lucide-react is pinned to 1.34.0 (unusual) — icons resolve, but worth confirming it's the package you intend.
