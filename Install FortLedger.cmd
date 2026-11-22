@echo off
setlocal
cd /d "%~dp0"
title FortLedger - Windows Setup
echo FortLedger local Windows installation - Node.js 22 and Git required.
echo Code and private hotel records will be stored in separate directories.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-setup.ps1"
set "code=%ERRORLEVEL%"
if not "%code%"=="0" echo SETUP INCOMPLETE. Review the error; do not reset or delete hotel data.
echo.
pause
exit /b %code%
