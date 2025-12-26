param(
  [string]$LogFile = "dev-keep.log"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$path = Join-Path $repoRoot $LogFile

if (-not (Test-Path $path)) {
  Write-Host "Log not found: $path"
  exit 1
}

Write-Host "Opening: $path"
Start-Process explorer.exe "/select,`"$path`""
