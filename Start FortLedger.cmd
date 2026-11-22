@echo off
setlocal
cd /d "%~dp0"
title FortLedger - Local Hotel App
echo Starting the existing local hotel ledger. Close this window only after staff finish their work.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-start.ps1"
set "code=%ERRORLEVEL%"
echo.
echo FortLedger server stopped. Hotel data was not deleted.
if not "%code%"=="0" echo Startup or update supervisor reported a problem. Inspect the console and run Diagnose FortLedger.cmd.
pause
exit /b %code%
