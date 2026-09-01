@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Trade with Rakhi

echo ==================================================
echo   Trade with Rakhi  -  starting up
echo ==================================================

REM --- 1. Python dependencies (only if Flask is missing) ---
python -c "import flask" 1>nul 2>nul
if errorlevel 1 (
  echo [setup] Installing Python dependencies...
  python -m pip install -r requirements.txt
)

REM --- 2. ALWAYS rebuild the frontend so the running app reflects the latest source ---
echo [build] Rebuilding the app from latest source ^(a few seconds^)...
pushd frontend
if not exist "node_modules" (
  echo [setup] Installing npm packages ^(first run only^)...
  call npm install
)
call npm run build
popd
if not exist "frontend\dist\index.html" (
  echo [ERROR] Frontend build failed. Check the messages above.
  pause
  exit /b 1
)

REM --- 3. Is it already running? ---
powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue){exit 0}else{exit 1}" 1>nul 2>nul
if not errorlevel 1 (
  echo [info] Server already running. Opening browser...
  start "" http://127.0.0.1:5000
  exit /b 0
)

REM --- 4. Start the server (minimized, logging to backend.log) ---
echo [run] Starting server on http://127.0.0.1:5000 ...
start "TWR-Server" /min cmd /c "python src\app.py > backend.log 2>&1"

REM --- 5. Wait until it answers, then open the browser ---
powershell -NoProfile -Command "for($i=0;$i -lt 40;$i++){try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/ -TimeoutSec 1 | Out-Null; exit 0}catch{Start-Sleep -Milliseconds 500}}; exit 1"
if errorlevel 1 (
  echo [WARN] Server did not respond in time. Check backend.log ^(is MetaTrader 5 running?^).
) else (
  echo [ok] Running.
)
start "" http://127.0.0.1:5000

echo ==================================================
echo   Open at http://127.0.0.1:5000
echo   Run STOP.bat to shut everything down.
echo ==================================================
timeout /t 4 /nobreak >nul
exit /b 0
