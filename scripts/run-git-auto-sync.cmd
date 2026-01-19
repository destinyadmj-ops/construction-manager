@echo off
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "C:\Users\desti\Master Hub\master-hub\scripts\run-git-auto-sync.ps1"
:: Ensure logs directory exists
if not exist "%~dp0logs" mkdir "%~dp0logs"
set LOGFILE=%~dp0logs\git-auto-sync-cmd.log
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "C:\Users\desti\Master Hub\master-hub\scripts\run-git-auto-sync.ps1" >> "%LOGFILE%" 2>>&1
