param(
  [int]$Port = 3000,
  [string]$HealthPath = "/api/health",
  [int]$TimeoutSec = 30,
  [int]$PollMs = 500
)

$ErrorActionPreference = 'Stop'

if (-not $PSBoundParameters.ContainsKey('Port')) {
  $envPort = $env:PORT
  if ($envPort -and ($envPort -as [int])) {
    $Port = [int]$envPort
  }
}

$hostsToTry = @('127.0.0.1', 'localhost')
$urlsToTry = $hostsToTry | ForEach-Object { "http://$($_):$Port$HealthPath" }
Write-Host "Waiting for health: $($urlsToTry -join ' | ') (timeout=${TimeoutSec}s)"

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  foreach ($url in $urlsToTry) {
    try {
      $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $url
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
        Write-Host ("OK {0} ({1})" -f $res.StatusCode, $url)
        exit 0
      }
    } catch {
      # keep waiting
    }
  }
  Start-Sleep -Milliseconds $PollMs
}

Write-Host "Timeout. Check dev-keep.log."
exit 1
