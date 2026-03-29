@echo off
REM Run the audit script from project root and propagate exit code
SET ROOT=%~dp0\..
SET PYVENV=%ROOT%\.venv\Scripts\python.exe
IF EXIST "%PYVENV%" (
    pushd %ROOT%
    "%PYVENV%" tools\audit_indicators_monitor_logs.py %*
    SET RC=%ERRORLEVEL%
    popd
) ELSE (
    pushd %ROOT%
    powershell -NoProfile -ExecutionPolicy Bypass -Command "& { python tools/audit_indicators_monitor_logs.py %* }"
    SET RC=%ERRORLEVEL%
    popd
)
EXIT /B %RC%
