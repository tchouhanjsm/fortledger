@echo off
setlocal
cd /d "%~dp0"
title FortLedger - Protected Backup Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-configure-backups.ps1"
set "code=%ERRORLEVEL%"
if not "%code%"=="0" echo Protected backup configuration did not complete.
echo.
pause
exit /b %code%
