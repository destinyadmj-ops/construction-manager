param(
  [string]$LogFile = "dev-keep.log",
  [switch]$Archive
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$path = Join-Path $repoRoot $LogFile

if (-not (Test-Path $path)) {
  Write-Host "Log not found: $path"
  exit 0
}

if ($Archive) {
  $ts = Get-Date -Format "yyyyMMdd-HHmmss"
  $dst = Join-Path $repoRoot ("{0}.{1}.bak" -f $LogFile, $ts)
  Copy-Item -Force $path $dst
  Write-Host "Archived: $dst"
}

Set-Content -LiteralPath $path -Value "" -Encoding utf8
Write-Host "Cleared: $path"
