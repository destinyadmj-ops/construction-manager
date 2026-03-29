#!/usr/bin/env pwsh
param(
    [string]$webhook
)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Join-Path $scriptDir '..'
Set-Location $projectRoot
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (Test-Path $venvPython) {
    & $venvPython tools\audit_indicators_monitor_logs.py @(if ($webhook) { "--webhook"; $webhook } )
    exit $LASTEXITCODE
} else {
    python tools\audit_indicators_monitor_logs.py @(if ($webhook) { "--webhook"; $webhook } )
    exit $LASTEXITCODE
}
