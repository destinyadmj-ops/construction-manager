param(
  [int]$Port = 3000,
  [string]$HealthPath = "/api/health",
  [int]$TimeoutSec = 2
)

$ErrorActionPreference = 'Stop'

if (-not $PSBoundParameters.ContainsKey('Port')) {
  $envPort = $env:PORT
  if ($envPort -and ($envPort -as [int])) {
    $Port = [int]$envPort
  }
}

$urls = @(
  "http://127.0.0.1:$Port$HealthPath",
  "http://localhost:$Port$HealthPath"
)

foreach ($url in $urls) {
  Write-Host "Checking: $url"
  try {
    $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec $TimeoutSec -Uri $url
    if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
      Write-Host ("OK {0}" -f $res.StatusCode)
      exit 0
    }
    Write-Host ("FAIL: non-2xx ({0})" -f $res.StatusCode)
  } catch {
    Write-Host ("FAIL: {0}" -f $_.Exception.Message)
  }
}

exit 1
