@echo off
setlocal
cd /d "%~dp0"
title FortLedger - Safe Windows Update
echo.
echo FortLedger - Update from GitHub main, verify backups, test, and restart.
echo Stop the running FortLedger window with Ctrl+C before continuing.
echo Your hotel data is stored outside the Git checkout.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-quick-update.ps1"
set "code=%ERRORLEVEL%"
if not "%code%"=="0" (
  echo.
  echo UPDATE NOT COMPLETED. Do not remove hotel data or reset Git.
  echo Review the error above and the existing backup before retrying.
) else (
  echo.
  echo Update completed. Check the newly opened FortLedger window.
)
pause
exit /b %code%
