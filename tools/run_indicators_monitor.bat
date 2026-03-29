@echo off
REM Wrapper batch to invoke the monitor and propagate the underlying exit code
SETLOCAL
SET ROOT=%~dp0\..
SET PYVENV=%ROOT%\.venv\Scripts\python.exe
IF EXIST "%PYVENV%" (
    pushd %ROOT%
    "%PYVENV%" -m bot_v2.ops.indicators_monitor %*
    popd
    SET RC=%ERRORLEVEL%
) ELSE (
    pushd %ROOT%
    powershell -NoProfile -ExecutionPolicy Bypass -Command "& { python -m bot_v2.ops.indicators_monitor %* }"
    popd
    SET RC=%ERRORLEVEL%
)
ENDLOCAL & EXIT /B %RC%
