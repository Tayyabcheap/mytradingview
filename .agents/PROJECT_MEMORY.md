# Project Memory & Context: MyTradingView

**Last Updated:** September 11, 2026  
**Repository:** `https://github.com/haider2804/mytradingview.git`  
**Branch:** `main` (clean, fully in sync)

---

## 1. System Architecture & Components

`MyTradingView` is a full-stack algorithmic trading workstation consisting of:

1. **Frontend (`frontend/`)**:
   - Built with **React 19 + Vite**, modern dark glassmorphic terminal aesthetic.
   - **TradingView-style Charting**: Advanced candlestick chart rendering, multi-timeframe navigation (1M, 5M, 15M, 1H, 4H, 1D), custom indicators (EMA, MACD, RSI, ATR, Order Blocks, Liquidity, SR Zones).
   - **Pine Script v6 Engine (`pineEngine.js`)**: Interactive script execution directly in the browser with full overlay/study support.
   - **Operational Tabs**:
     - `DashboardTab`: Core overview, market activity, active orders, and broker connection status.
     - `Chart`: Full-featured KLine trading chart with drawing tools and order management.
     - `TradeJournalTab`: Deal-pairing trade journal with statistics, performance metrics, and history logs.

2. **Backend (`src/`)**:
   - **Flask Application (`src/app.py`)**: REST endpoints and WebSocket/event streaming for quotes, chart data, orders, alarms, and engine control.
   - **Signal Engine (`src/signal_engine.py`)**: Real-time SMC and Swing strategy setup generator.
   - **Account Guardian (`src/trading_account.py`)**: Strict gate ensuring MT5 connects only to configured demo accounts, preventing real money exposure.
   - **Market Clock (`src/market_clock.py`)**: Time management enforcing weekend flat rules and Friday wind-down.
   - **MetaTrader 5 Bridge**: Interfaces with MetaTrader 5 terminal Python API for order placement and market data.
   - **Backtester (`src/backtester.py`)**: Comprehensive trade management simulation and backtesting.

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
git clone https://<GITHUB_USER>:<PAT_TOKEN>@github.com/haider2804/MyFinanceAdvisor.git
cd MyFinanceAdvisor
```

### Step 2: Python Environment Setup
Install dependencies directly using system Python (no virtual environment required):
```bash
pip install -r requirements.txt
```
*(Note: Python 3.10 through 3.14+ are supported. Unused dependencies like `pandas-ta`/`numba` have been removed to ensure seamless compatibility with Python 3.14.)*

### Step 3: Frontend Build
```bash
cd frontend
npm install
npm run build
cd ..
```

### Step 4: Local Configuration (Optional)
If your MT5 terminal is already logged into your demo account on the desktop, the workstation will attach to it automatically.
Optionally, create `secrets.local.json` in the root folder (git-ignored) if you want the backend to automatically log in or lock to a specific account:
```json
{
  "login": 12345678,
  "password": "your_account_password",
  "server": "Exness-MT5Trial16",
  "allow_live_account": false
}
```

### Step 5: Verification
```bash
# Run pytest test suite (29 tests)
python -m pytest

# Run parity check (17 test cases, 0 drift)
python tools/parity_check.py
```

### Step 6: Launch the Workstation Server
- **On Windows (Interactive / GUI)**:
  Double-click `start.bat` or run:
  ```powershell
  .\start.bat
  ```
- **Direct Python Launch (Windows or Linux)**:
  ```bash
  python src/app.py
  ```
  *(The server listens on port `5000` and automatically logs activity to `backend.log`)*

### Step 7: Connecting to the Workstation

#### Option A: Secure SSH Port Forwarding (Recommended from Local PC)
From your local terminal, create an encrypted SSH tunnel to the remote VM:
```bash
ssh -L 5000:127.0.0.1:5000 <user>@<VM_IP_OR_HOSTNAME>
```
Once connected, open your **local** browser to:
`http://127.0.0.1:5000`

#### Option B: Remote Desktop (RDP / VNC) Inside VM
If logged into the Windows VM desktop via RDP, launch `start.bat` and open the browser inside the RDP session to:
`http://127.0.0.1:5000`

#### Option C: Direct Remote IP Access
To access directly via `http://<VM_IP>:5000`:
1. Ensure the VM cloud firewall / security group allows inbound TCP on port `5000`.
2. The server binds to `0.0.0.0` by default and dynamically validates same-host requests.

---

## 4. Key Architectural Mechanisms & Safety Constraints

### Broker Symbol Auto-Resolution
Brokers use varied symbol naming conventions (e.g. `XAUUSD`, `XAUUSDm`, `XAUUSDc`, `XAUUSD.m`).
- Backend `resolve_broker_symbol(symbol)` in `src/app.py` queries `mt5.symbols_get()` and falls back through known suffixes.
- Applied across `/api/history`, `/api/quote`, `/api/quotes`, `/api/indicator`, `/api/signals`, `/api/order/send`, `/api/backtest/gold_scalper`, and `/api/signals/accuracy`.
- Frontend `App.jsx` auto-aligns the user's active symbol to the broker's real gold symbol on startup.

### Cold MT5 History Synchronization
On fresh MT5 installations or new symbols, the local cache may be empty until MT5 downloads rates from the server.
- `/api/history` implements an automatic retry loop (3 attempts with 250ms delay).
- Frontend chart (`KLineChartArea.jsx`) automatically retries bar fetching if the initial sync is empty.

### Active MT5 Session Attachment (`trading_account.py`)
- If MT5 is already running and authenticated on the desktop, `trading_account.connect()` safely attaches and verifies the active session without requiring manual credentials in `secrets.local.json`.
- Strict gates remain enforced:
  1. **Demo Account Only**: Blocks immediately if the terminal is logged into a live account (unless `allow_live_account` is explicitly set).
  2. **Algo Trading Check**: Requires the MT5 "Algo Trading" button to be enabled (green) before placing orders.
  3. **Gold / XAUUSD Lot Cap**: Strictly capped at **`1.0`** (`XAUUSD`, `XAUUSDc`, `XAUUSDm`).
  4. **Risk Cap**: `MAX_RISK_PERCENT` <= `1.0%` of account equity.

### Safety Limits & Trading Gates
1. **Demo Account Only**: Blocks immediately if the terminal is logged into a live account (unless `allow_live_account` is explicitly set).
2. **Algo Trading Check**: Requires the MT5 "Algo Trading" button to be enabled (green) before placing automated or script orders.
3. **Gold / XAUUSD Lot Cap**: Strictly capped at **`1.0`** (`XAUUSD`, `XAUUSDc`, `XAUUSDm`).
4. **Risk Cap**: `MAX_RISK_PERCENT` <= `1.0%` of account equity.



