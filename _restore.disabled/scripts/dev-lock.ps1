param(
  [switch]$Clear,
  [switch]$Force,
  [int]$StaleSeconds = 600
)

$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent $PSScriptRoot
$lockPath = Join-Path $repoRoot '.next\dev\lock'

if (-not (Test-Path $lockPath)) {
  Write-Host "No lock: $lockPath"
  exit 0
}

$item = Get-Item $lockPath -ErrorAction SilentlyContinue
$ageSec = $null
if ($item) {
  $ageSec = (New-TimeSpan -Start $item.LastWriteTime -End (Get-Date)).TotalSeconds
}

Write-Host ("Lock present: {0}" -f $lockPath)
if ($ageSec -ne $null) {
  Write-Host ("Age: {0:n0}s" -f $ageSec)
}

if (-not $Clear) {
  exit 0
}

if (-not $Force -and $ageSec -ne $null -and $ageSec -lt $StaleSeconds) {
  Write-Host ("Refusing to clear lock younger than {0}s. Use -Force to override." -f $StaleSeconds)
  exit 2
}

try {
  Remove-Item -Force $lockPath -ErrorAction Stop
  Write-Host "Cleared lock."
  exit 0
} catch {
  Write-Host ("Failed to clear lock: {0}" -f $_.Exception.Message)
  exit 1
}
