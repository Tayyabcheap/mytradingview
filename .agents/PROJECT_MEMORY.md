# Project Memory & Context: MyFinanceAdvisor

**Last Updated:** September 7, 2026  
**Repository:** `https://github.com/haider2804/MyFinanceAdvisor.git`  
**Branch:** `main` (clean, fully in sync)

---

## 1. System Architecture & Components

`MyFinanceAdvisor` is a full-stack algorithmic trading workstation and autonomous strategy laboratory consisting of:

1. **Frontend (`frontend/`)**:
   - Built with **React 19 + Vite**, modern dark glassmorphic terminal aesthetic.
   - **TradingView-style Charting**: Advanced candlestick chart rendering, timeframes (1M, 5M, 15M, 1H, 4H, 1D), custom indicators (EMA, MACD, RSI, ATR, Order Blocks, Liquidity, SR Zones).
   - **MyBrains Research Floor (`MyBrainsTab.jsx`, `myBrainsLab.js`, `myBrainsCore.js`, `myBrainsStructure.js`)**:
     - Interactive neural-network org chart simulation of an investment firm with 18 departments and ~87 agents.
     - Genetic evolution and crossover algorithms that breed trading disciplines, cross-test across instruments, and audit strategy expectancy.
   - **Operational Tabs**:
     - `DashboardTab`: Core charting, trade execution panel, manual orders, and broker connection status.
     - `BrainsActivityTab`: Live stream of agent decisions, hires, demotions, and audit verdicts.
     - `BrainsPerformanceTab`: Equity curves, Sharpe ratios, expectancy, and portfolio allocation.
     - `ManualTab`: System documentation and user manual for operating the autonomous trading firm.

2. **Backend (`src/`)**:
   - **Flask Application (`src/app.py`)**: REST endpoints and WebSocket/event streaming for quotes, chart data, orders, alarms, and engine control.
   - **Autonomous Robot (`src/autotrader.py`)**: 5-second polling loop executing vetted strategies.
   - **Strategy Runtime (`src/strategy_runtime.py`)**: Pure Python execution engine mirroring `myBrainsLab.js` JavaScript research logic.
   - **Account Guardian (`src/trading_account.py`)**: Strict gate ensuring MT5 connects only to configured demo accounts, preventing real money exposure.
   - **Market Clock (`src/market_clock.py`)**: Time management enforcing weekend flat rules and Friday wind-down.
   - **MetaTrader 5 Bridge**: Interfaces with MetaTrader 5 terminal Python API for order placement and market data.

3. **Parity Verification (`tools/`)**:
   - `tools/parity_check.py`, `tools/parity_dump.mjs`: Ensures Python live execution (`strategy_runtime.py`) and JavaScript research engine (`myBrainsLab.js`) produce mathematically identical entries and exits (17 test cases, 0 drift).

---

## 2. Git & Repository Configuration

- **Remote URL**: `https://github.com/haider2804/MyFinanceAdvisor.git`
- **SSH Endpoint**: `git@github-personal:haider2804/MyFinanceAdvisor.git`
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
git clone git@github.com:haider2804/MyFinanceAdvisor.git
cd MyFinanceAdvisor

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

### Step 4: Local Configuration
Create `secrets.local.json` in the root folder (git-ignored):
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

### Troubleshooting `127.0.0.1 refused to connect`:
1. **Local vs. Remote Browser Confusion**: If you type `127.0.0.1:5000` into your local machine's browser without an active SSH tunnel (`ssh -L 5000:127.0.0.1:5000 ...`), the connection connects to your laptop instead of the remote VM.
2. **Server Not Running**: Check `backend.log` in the project root to inspect any Python runtime errors.
3. **Virtual Environment**: Ensure packages were installed into `.venv` and Python is pointing to `.venv\Scripts\python.exe`.
4. **Port In Use**: Run `stop.bat` to terminate any stale listeners on port `5000`.

---

## 4. Safety & Trading Constraints

1. **Demo Account Only**: The trading engine refuses to execute on live accounts unless `allow_live_account: true` is explicitly configured.
2. **Gold / XAUUSD Lot Cap**: Never execute or allow lot sizes greater than **`1.0`** on Gold (`XAUUSD`, `XAUUSDc`).
3. **Risk Cap**: `MAX_RISK_PERCENT` must not exceed `1.0%` of account equity per trade.
4. **Autotrader 8 Gates**:
   1. Robot enabled in UI / config.
   2. MT5 logged into authorized demo account.
   3. Market open (weekday hours, flat prior to weekend close).
   4. Published strategy has passed full Audit sign-off.
   5. Strategy sign-off is less than 24 hours old.
   6. Strategy discipline is reproducible by Python runtime.
   7. Today's loss stop and max trades cap (Legal dept) not hit.
   8. Valid setup confirmed on the last closed bar.
