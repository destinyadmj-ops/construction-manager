param(
  [int[]]$Candidates = @(3000, 3001),
  [string]$HealthPath = "/api/health",
  [int]$TimeoutMs = 700
)

$ErrorActionPreference = 'Stop'

function Test-HealthUrl {
  param(
    [string]$Url,
    [int]$TimeoutMs
  )

  $timeoutSec = [Math]::Max(1, [Math]::Ceiling($TimeoutMs / 1000.0))
  try {
    $res = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $timeoutSec
    return ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function Test-PortListening {
  param(
    [int]$Port
  )

  try {
    $tcp = Test-NetConnection 127.0.0.1 -Port $Port -WarningAction SilentlyContinue
    return [bool]$tcp.TcpTestSucceeded
  } catch {
    return $false
  }
}

# Policy:
# 1) If a candidate already serves healthy /api/health, pick it.
# 2) Otherwise, prefer the first candidate that is NOT listening (free to start).
# 3) Otherwise, fall back to the last candidate.

foreach ($p in $Candidates) {
  $url = "http://127.0.0.1:$p$HealthPath"
  if (Test-HealthUrl -Url $url -TimeoutMs $TimeoutMs) {
    Write-Output $p
    exit 0
  }
}

foreach ($p in $Candidates) {
  if (-not (Test-PortListening -Port $p)) {
    Write-Output $p
    exit 0
  }
}

Write-Output $Candidates[-1]
exit 0
