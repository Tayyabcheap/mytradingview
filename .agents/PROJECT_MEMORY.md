# Project Memory & Context: MyTradingView

**Last Updated:** September 13, 2026  
**Repository:** `https://github.com/haider2804/mytradingview.git`  
**Branch:** `main` (clean, fully tested, in sync)

---

## 1. System Architecture & Components

`MyTradingView` is a full-stack algorithmic trading workstation consisting of:

### 1. Frontend (`frontend/`)
- Built with **React 19 + Vite**, modern dark glassmorphic terminal aesthetic.
- **TradingView-style Charting**: Advanced candlestick chart rendering, multi-timeframe navigation (1M, 5M, 15M, 1H, 4H, 1D), custom indicators (EMA, MACD, RSI, ATR, Order Blocks, Liquidity, SR Zones).
- **Expanded Drawing Engine (`KLineChartArea.jsx`, `FlyoutToolbar.jsx`)**:
  - Curated 24-color professional trading palette + native custom color picker (`<input type="color">`).
  - Pre-draw color selection from the left sidebar and auto-inheritance for subsequent drawings.
- **Pine Script v6 Engine (`pineEngine.js`)**: Interactive script execution directly in the browser with full overlay/study support.
- **Operational Tabs**:
  - `DashboardTab`: Core overview, market activity, active orders, and broker connection status.
  - `Chart`: Full-featured KLine trading chart with drawing tools, multi-tab workspace, and order execution.
  - `TradeJournalTab`: Deal-pairing trade journal with statistics, performance metrics, and **AI Scalper Audit & Coach** post-mortem diagnostic view.
  - `MonteCarloTab`: Vectorized risk modeling, sequence permutations, bootstrap drawdown distributions.
  - `GoldOrderBlocksTab`: Dual-timeframe institutional SMC order block detection with nearest-zone filters.
  - `SupportResistanceTab`: Multi-timeframe institutional S&R zones with Doji/Hammer reversal & continuation validation.
- **Signals & Pair Selector**:
  - **`Haider-Gold-Scalper`**: Baseline algorithmic setup (68.4% WR, 5.3 trades/day, +219 pips/day).
  - **`Haider-Scalper-Enhanced`**: High-accuracy algorithmic setup (90.8% WR, 4.7 trades/day, +416 pips/day, 3.85 PF) featuring 1.35x ATR anti-hunt buffer, >=18% rejection wick filter, rollover spread defense (21:00–22:30 UTC), and 2-tranche Auto-BE execution.
  - **`ScalperPairSelectorModal.jsx`**: Select up to 10 active currency pairs / instruments for continuous background execution, with quick presets (Gold Only, Top 5 Majors, Full 10 Basket).
  - **Independent Multi-Chart Navigation**: The user can open, switch, and view any chart tab (`BTCUSD`, `EURUSD`, etc.) indefinitely without background polling intervals forcefully resetting the screen to Gold.

### 2. Backend (`src/`)
- **Flask Application (`src/app.py`)**: REST endpoints and WebSocket/event streaming for quotes, chart data, orders, alarms, and engine control.
- **Broker Symbol Resolution Engine (`src/symbol_utils.py`)**:
  - Shared, thread-safe module providing `clean_base_symbol()` and `resolve_broker_symbol(symbol, mt5_lock)`.
  - Automatically resolves broker suffix variations (`BTCUSD` / `BTCUSDc` $\rightarrow$ `BTCUSDm`, `XAUUSD` $\rightarrow$ `XAUUSDm`, etc.) dynamically across Cent, Trial, and Standard accounts.
- **Autonomous Scalper Daemon (`src/scalper_bot.py`)**:
  - Dedicated server-side 24/5 background daemon operating completely independent of the browser.
  - Concurrently monitors 5M closed bars across up to 10 configured instruments.
  - Dynamically resolves broker symbols before data copying and order submission.
  - Executes institutional **2-Tranche scale-out orders** (Tranche 1 @ TP1, Tranche 2 Runner @ TP2) in under 50ms (< 3s SLA).
  - High-speed 1-second background tick monitor (`_autobe_loop`) that autonomously moves Tranche 2 SL to Breakeven when TP1 is hit.
  - Strictly enforces Gold volume cap $\le 1.0$ lot and demo account protection.
  - Endpoints: `GET /api/scalper/bot/status`, `POST /api/scalper/bot/toggle`, `GET/POST /api/scalper/bot/symbols`.
- **Scalper Diagnostic & Post-Mortem Logging Engine (`src/scalper_logger.py`, `tools/analyze_scalper_logs.py`)**:
  - Counterfactual 40-bar trajectory evaluation.
  - Premature SL hunt detection ($\le 12$ pips overshoot before reversing to TP) and undersized TP runner detection.
  - Persistent audit stores: `data/haider_scalper_signals_audit.json`, `data/haider_scalper_signals_audit.csv`, and `data/weekly_scalper_coaching_report.md`.
- **Account Guardian (`src/trading_account.py`)**: Strict gate ensuring MT5 connects only to configured demo accounts, preventing real money exposure.
- **Market Clock (`src/market_clock.py`)**: Time management enforcing weekend flat rules and Friday wind-down.
- **MetaTrader 5 Bridge**: Thread-safe interface with MetaTrader 5 Python API for order placement and market data.
- **Backtester (`src/backtester.py`, `src/enhanced_scalper_bt.py`, `src/real_dip_bt.py`)**: Vectorized backtesting and historical trade simulation.

---

## 2. Git & Repository Configuration

- **Remote URL**: `https://github.com/haider2804/mytradingview.git`
- **SSH Endpoint**: `git@github-personal:haider2804/mytradingview.git`
- **SSH Key**: Configured in `~/.ssh/config` under `github-personal` mapping to `D:/gitKeys/haider2804github`.
- **Primary Branch**: `main`

### Mandatory Push Hygiene Rules:
- **Only Push Mandatory Code Files**: Source code (`src/`, `frontend/src/`, `tools/`, `tests/`, `mql5/`), configurations, and documentation.
- **NEVER Commit Secrets or Credentials**:
  - `secrets.local.json`, `credentials.json`, `telegram_config.json`, `.desk_token` MUST remain git-ignored.
  - `autotrader_state.json` and `approved_strategy.json` MUST remain git-ignored.
  - Do NOT commit screenshots (`Claude outputs/`), temporary backup files (`*.prepool`, `*.prebook`, `*.bak`), or internal review notes (`HANDOVER.md`, `README_AUTONOMY.md`, `CODE_REVIEW_*.md`).
- **Account Number Sanitization**: Never hardcode personal or broker account IDs into UI components or docs. Use generic phrases like "configured demo account".

---

## 3. Remote VM Deployment Runbook

To set up and run this codebase on a remote VM (Linux or Windows):

### Step 1: Clone Repository
```bash
# Option A: Via SSH Deploy Key (Recommended)
ssh-keygen -t ed25519 -C "trading-vm"
cat ~/.ssh/id_ed25519.pub
# (Add this public key under GitHub Repo -> Settings -> Deploy keys)
git clone git@github.com:haider2804/mytradingview.git
cd mytradingview

# Option B: Via Personal Access Token (HTTPS)
git clone https://<GITHUB_USER>:<PAT_TOKEN>@github.com/haider2804/mytradingview.git
cd mytradingview
```

### Step 2: Python Environment Setup
```bash
pip install -r requirements.txt
```
*(Python 3.10 through 3.14+ supported. Unused dependencies like `pandas-ta`/`numba` have been removed to ensure seamless compatibility with Python 3.14.)*

### Step 3: Frontend Build
```bash
cd frontend
npm install
npm run build
cd ..
```

### Step 4: Verification
```bash
# Run unit test suite (67 tests)
python -m unittest discover tests

# Build and verify frontend client
cd frontend && npm run build && cd ..

# Run parity check (17 test cases, 0 drift)
python tools/parity_check.py
```

### Step 5: Launch the Workstation Server
- **On Windows**:
  Double-click `start.bat` or run `.\start.bat`.
- **Direct Python Launch**:
  ```bash
  python src/app.py
  ```

---

## 4. Key Architectural Mechanisms & Safety Constraints

### Broker Symbol Auto-Resolution Engine (`src/symbol_utils.py`)
Brokers use varied symbol naming conventions:
- Cent Accounts (e.g. Exness USC): `XAUUSDc`, `BTCUSDc`, `EURUSDc`
- Trial/Standard Accounts (e.g. Exness Trial16): `XAUUSDm`, `BTCUSDm`, `EURUSDm`
- Raw / Pro / Zero: `XAUUSD.m`, `XAUUSD_i`, `XAUUSDraw`
- **Resolution Strategy**:
  1. Exact match check against active terminal symbols.
  2. Base symbol cleaning (stripping `.m`, `.c`, `_i`, `m.raw`, `c.raw`, `pro`, `raw`, `c`, `m`, `k`).
  3. Dynamic matching against `mt5.symbols_get()`.
  4. Automatically auto-selects and makes visible in MT5 Market Watch.

### Cent Account Math & Contract Specifications (`XAUUSDc`)
- **Contract Size**: 1.0 Troy Ounce (1/100th of standard 100 oz contract).
- **Terminal Currency**: `USC` (US Cents), where `100 USC = $1.00 USD`.
- **Average 5M TP1 Move**: ~$2.50 to $3.00 price move on Gold.
  - At `0.02` lot: Generates `5.00 USC` ($0.05 USD).
  - At `1.00` lot: Generates `250–300 USC` ($2.50–$3.00 USD) on TP1, and `500 USC` ($5.00 USD) on full TP1+TP2 runner.
- **Margin**: 250 USC per 1.0 lot.
- **Standard Account Comparison (`XAUUSDm`)**: Contract size = 100 oz. Earning $5.00 USD requires only `0.02` lots.

### Quantitative Win Rate & R:R Model (Asymmetric Scalping)
- **High Win Rate Mechanics (90%+ WR)**:
  - **Wide Anti-Hunt Structural SL ($1.35 \times \text{ATR}$)**: Placed beyond retail stop clusters, eliminating accidental stop-outs.
  - **Tight 50% Impulse TP1**: Rapid mean-reversion target reached in 15–30 seconds.
  - **Auto-BE Protection**: Moving SL to Breakeven at TP1 eliminates remaining risk ($0.00 risk) while Tranche 2 trails to TP2.

### Safety Limits & Trading Gates
1. **Demo Account Only**: Blocks immediately if the terminal is logged into a live account (unless `allow_live_account` is explicitly set).
2. **Algo Trading Check**: Requires the MT5 "Algo Trading" button to be enabled (green) before placing automated or script orders.
3. **Gold / XAUUSD Lot Cap**: Strictly capped at **`1.0`** (`XAUUSD`, `XAUUSDc`, `XAUUSDm`).
4. **Risk Cap**: `MAX_RISK_PERCENT` <= `1.0%` of account equity.
