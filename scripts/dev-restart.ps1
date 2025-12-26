param(
  [int]$WaitSeconds = 30
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "Stopping..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev-stop.ps1')

Write-Host "Starting (background)..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev-keep-bg.ps1')

Write-Host "Waiting up to ${WaitSeconds}s for health..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev-health-wait.ps1') -TimeoutSec $WaitSeconds
if ($LASTEXITCODE -eq 0) {
  Write-Host "Ready."
  exit 0
}

Write-Host "Not ready. Check dev-keep.log."
exit 1
