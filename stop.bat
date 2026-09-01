@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Trade with Rakhi - Stop

echo ==================================================
echo   Trade with Rakhi  -  stopping
echo ==================================================

REM Kill whatever is listening on port 5000 (the server), robustly.
powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -Expand OwningProcess -Unique; if($p){ $p | ForEach-Object { try{ Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host ('Stopped PID ' + $_) }catch{} } } else { Write-Host 'Server was not running.' }"

REM Fallback for older Windows without Get-NetTCPConnection.
for /f "tokens=5" %%T in ('netstat -a -n -o ^| findstr ":5000" ^| findstr LISTENING') do taskkill /F /PID %%T 1>nul 2>nul

echo Done.
timeout /t 3 /nobreak >nul
exit /b 0
