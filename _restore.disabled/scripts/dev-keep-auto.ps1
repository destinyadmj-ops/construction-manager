param(
  [int]$DelaySeconds = 3,
  [string]$LogFile = "dev-keep.log",
  [string]$HealthPath = "/api/health",
  [int]$HealthTimeoutMs = 800,
  [int]$IdleCheckSeconds = 2,
  [int]$StaleLockSeconds = 600
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$picker = Join-Path $PSScriptRoot 'pick-port.ps1'

$port = & powershell -NoProfile -ExecutionPolicy Bypass -File $picker -Candidates @(3000, 3001) -HealthPath $HealthPath -TimeoutMs $HealthTimeoutMs
if (-not $port -or -not ($port -as [int])) {
  $port = 3000
}
$port = [int]$port

Write-Host ("[INFO] Auto-picked port: {0}" -f $port)
$env:PORT = "$port"

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev-keep.ps1') \
  -DelaySeconds $DelaySeconds \
  -LogFile $LogFile \
  -Port $port \
  -HealthPath $HealthPath \
  -HealthTimeoutMs $HealthTimeoutMs \
  -IdleCheckSeconds $IdleCheckSeconds \
  -StaleLockSeconds $StaleLockSeconds

exit $LASTEXITCODE
