@echo off
setlocal
cd /d "%~dp0"
title FortLedger - Import Existing Hotel Data
echo FortLedger: existing hotel data handover (not for a new empty installation).
echo Requires a verified backup folder with fortledger.sqlite, admin-auth.json, RECOVERY.txt.
echo No live Mac SQLite WAL files. No GitHub uploads or deletion of existing data.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-import-handover.ps1"
set "code=%ERRORLEVEL%"
if not "%code%"=="0" echo HANDOVER NOT COMPLETED. Stop and inspect. Do not reset or delete hotel data.
echo.
pause
exit /b %code%
