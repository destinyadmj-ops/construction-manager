@echo off
:: Ensure logs directory exists
if not exist "%~dp0logs" mkdir "%~dp0logs"
:: get yyyyMMdd via PowerShell to avoid locale issues
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"`) do set TODAY=%%i
set LOGFILE=%~dp0logs\git-auto-sync-cmd-%TODAY%.log
"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "C:\Users\desti\Master Hub\master-hub\scripts\run-git-auto-sync.ps1" >> "%LOGFILE%" 2>>&1
