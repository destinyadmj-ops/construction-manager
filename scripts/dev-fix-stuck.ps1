param(
  [int]$Port = 3000,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not $PSBoundParameters.ContainsKey('Port')) {
  $envPort = $env:PORT
  if ($envPort -and ($envPort -as [int])) {
    $Port = [int]$envPort
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "Fixing stuck dev (lock/next dev/port) for port $Port..."

# 1) show lock
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev-lock.ps1')

# 2) kill next dev if asked
if ($Force) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev-next-dev.ps1') -Kill -Force
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev-lock.ps1') -Clear -Force
}

# 3) show port listeners
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev-port-who.ps1') -Port $Port

Write-Host "Done. Next: npm run dev:restart"
