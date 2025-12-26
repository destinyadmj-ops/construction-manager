param(
  [string]$PidFile = "dev-keep.pid"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $repoRoot $PidFile

if (-not (Test-Path $pidPath)) {
  Write-Host "PID file not found: $pidPath"
  exit 0
}

$pidRaw = (Get-Content -LiteralPath $pidPath | Select-Object -First 1)
if (-not ($pidRaw -as [int])) {
  Remove-Item -Force $pidPath
  Write-Host "Invalid PID file. Removed."
  exit 0
}

$procId = [int]$pidRaw
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
if ($null -eq $p) {
  Remove-Item -Force $pidPath
  Write-Host "Process already stopped. Removed PID file."
  exit 0
}

Stop-Process -Id $procId -Force
Remove-Item -Force $pidPath
Write-Host "Stopped background dev:keep (pid=$procId)."