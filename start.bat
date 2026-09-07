@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Trade with Rakhi

echo ==================================================
echo   Trade with Rakhi  -  starting up
echo ==================================================

REM --- 0. Detect Python executable (prefer .venv if present) ---
set "PY_CMD=python"
if exist ".venv\Scripts\python.exe" (
  set "PY_CMD=.venv\Scripts\python.exe"
  echo [info] Using virtual environment .venv
) else if exist "venv\Scripts\python.exe" (
  set "PY_CMD=venv\Scripts\python.exe"
  echo [info] Using virtual environment venv
)

REM --- 1. Python dependencies (only if Flask is missing) ---
%PY_CMD% -c "import flask" 1>nul 2>nul
if errorlevel 1 (
  echo [setup] Installing Python dependencies...
  %PY_CMD% -m pip install -r requirements.txt
)

REM --- 2. Build frontend if npm is available ---
where npm 1>nul 2>nul
if not errorlevel 1 (
  echo [build] Rebuilding the app from latest source ^(a few seconds^)...
  pushd frontend
  if not exist "node_modules" (
    echo [setup] Installing npm packages ^(first run only^)...
    call npm install
  )
  call npm run build
  popd
) else (
  echo [info] npm not detected in PATH.
  if not exist "frontend\dist\index.html" (
    echo [WARN] frontend\dist\index.html not found and npm is not installed.
    echo Please install Node.js on the VM or build the frontend locally before deploying.
  ) else (
    echo [info] Using existing pre-built frontend in frontend\dist.
  )
)

REM --- 3. Is it already running? ---
powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue){exit 0}else{exit 1}" 1>nul 2>nul
if not errorlevel 1 (
  echo [info] Server already running. Opening browser...
  start "" http://127.0.0.1:5000
  exit /b 0
)

REM --- 4. Start the server (minimized, logging to backend.log) ---
echo [run] Starting server on port 5000 ...
start "TWR-Server" /min cmd /c ""%PY_CMD%" src\app.py > backend.log 2>&1"

REM --- 5. Wait until it answers, then open the browser ---
powershell -NoProfile -Command "for($i=0;$i -lt 40;$i++){try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/ -TimeoutSec 1 | Out-Null; exit 0}catch{Start-Sleep -Milliseconds 500}}; exit 1"
if errorlevel 1 (
  echo ==================================================
  echo [ERROR] Server failed to respond on http://127.0.0.1:5000
  echo Showing recent errors from backend.log:
  echo --------------------------------------------------
  powershell -NoProfile -Command "if (Test-Path backend.log) { Get-Content backend.log -Tail 25 } else { Write-Host 'backend.log not found.' }"
  echo --------------------------------------------------
  echo Press any key to exit...
  pause >nul
  exit /b 1
) else (
  echo [ok] Running successfully.
)
start "" http://127.0.0.1:5000

echo ==================================================
echo   Open at http://127.0.0.1:5000
echo   Run STOP.bat to shut everything down.
echo ==================================================
timeout /t 4 /nobreak >nul
exit /b 0
