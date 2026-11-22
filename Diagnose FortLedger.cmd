@echo off
setlocal
cd /d "%~dp0"
title FortLedger - Windows Diagnostics
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-diagnostics.ps1"
set "code=%ERRORLEVEL%"
echo.
pause
exit /b %code%
