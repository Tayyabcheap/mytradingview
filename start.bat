@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title MyTradingView

echo ==================================================
echo   MyTradingView  -  starting up
echo ==================================================

REM --- 0. Python executable ---
set "PY_CMD=python"
if defined VIRTUAL_ENV (
  echo [info] Running in virtual environment: %VIRTUAL_ENV%
) else (
  echo [info] Running with system Python
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

REM --- 3. Stop any existing server on port 5000 to ensure latest code runs ---
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -Expand OwningProcess -Unique; if($p){ $p | ForEach-Object { try{ Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host ('[info] Stopped existing server PID ' + $_) }catch{} } }"


REM --- 4. Start the server (minimized, logging to backend.log) ---
echo [run] Starting server on port 5000 ...
start "TWR-Server" /min cmd /c ""%PY_CMD%" src\app.py > backend.log 2>&1"

REM --- 5. Wait until it answers, then open the browser ---
powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5000/ -TimeoutSec 5 | Out-Null; exit 0}catch{Start-Sleep -Milliseconds 500}}; exit 1"
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
powershell -NoProfile -Command "Start-Sleep -Seconds 3"
exit /b 0
