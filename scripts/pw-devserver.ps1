param(
  [string]$BindHost = '127.0.0.1',
  [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

function Test-Health([string]$baseUrl) {
  try {
    $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri ("{0}/api/health" -f $baseUrl)
    return ($res.StatusCode -eq 200)
  } catch {
    return $false
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$baseUrl = "http://{0}:{1}" -f $BindHost, $Port

if (Test-Health $baseUrl) {
  Write-Host ("[INFO] existing server is healthy: {0} (will keep process alive)" -f $baseUrl)
  while ($true) { Start-Sleep -Seconds 3600 }
}

# If a stale dev lock exists and nothing is serving, clear it.
$lockPath = Join-Path $repoRoot '.next\dev\lock'
if (Test-Path $lockPath) {
  Write-Host ("[INFO] dev lock exists but server not healthy -> clearing lock: {0}" -f $lockPath)
  & (Join-Path $PSScriptRoot 'dev-lock.ps1') -Clear -Force
}

Write-Host ("[INFO] starting next dev: {0}" -f $baseUrl)
& npx next dev -H $BindHost -p $Port
$exitCode = $LASTEXITCODE

# If next dev failed but the server is now healthy (race), keep alive.
if ($exitCode -ne 0 -and (Test-Health $baseUrl)) {
  Write-Host ("[WARN] next dev exited with code={0}, but server is healthy now; keeping alive" -f $exitCode)
  while ($true) { Start-Sleep -Seconds 3600 }
}

exit $exitCode
