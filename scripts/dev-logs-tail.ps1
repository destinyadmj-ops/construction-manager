param(
  [string]$LogFile = "dev-keep.log",
  [int]$Tail = 200
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$path = Join-Path $repoRoot $LogFile

if (-not (Test-Path $path)) {
  Write-Host "Log not found: $path"
  exit 1
}

Get-Content -Tail $Tail -Wait -LiteralPath $path
