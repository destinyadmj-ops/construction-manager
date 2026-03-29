#!/usr/bin/env pwsh
# Wrapper for scheduled execution of the indicators monitor
# Usage: run_indicators_monitor.ps1 [--threshold 120] [--webhook <url>]

param(
    [int]$threshold = 120,
    [string]$webhook = $null
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# Move to project root (one level up from tools) so Python can import package modules
$projectRoot = Join-Path $scriptDir '..'
Set-Location $projectRoot

# Use virtualenv python if present for predictable environment
$venvPython = Join-Path $root '..\.venv\Scripts\python.exe'
if (Test-Path $venvPython) {
    $py = $venvPython
} else {
    $py = 'python'
}

$args = @('-m','bot_v2.ops.indicators_monitor','--threshold',$threshold)
if ($webhook) { $args += @('--webhook', $webhook) }

Write-Output "Running: $py $($args -join ' ')"
& $py @args
# Propagate child process exit code to caller (Task Scheduler expects it)
if ($LASTEXITCODE -ne $null) {
    exit $LASTEXITCODE
} else {
    exit 0
}
