param(
  [int]$WaitSeconds = 90,
  [int]$Port = 3000,
  [string]$HealthPath = "/api/health"
)

$ErrorActionPreference = 'Stop'

Write-Host 'Stopping production supervisor...'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-stop.ps1') -Port $Port

Write-Host 'Starting production supervisor (background)...'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-keep-bg.ps1') -Port $Port -HealthPath $HealthPath

Write-Host ("Waiting up to {0}s for health..." -f $WaitSeconds)
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  try {
    $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri ("http://127.0.0.1:{0}{1}" -f $Port, $HealthPath)
    if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
      Write-Host 'Ready.'
      exit 0
    }
  } catch {
    # keep waiting
  }

  Start-Sleep -Seconds 2
}

Write-Host 'Not ready. Check start-keep.log.'
exit 1