param(
  [string]$PidFile = "dev-keep.pid",
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

$repoRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $repoRoot $PidFile

Write-Host ("Repo: {0}" -f $repoRoot)

$lockPath = Join-Path $repoRoot '.next\dev\lock'
if (Test-Path $lockPath) {
  try {
    $ageSec = (New-TimeSpan -Start (Get-Item $lockPath).LastWriteTime -End (Get-Date)).TotalSeconds
    Write-Host ("Lock: present ({0:n0}s)" -f $ageSec)
  } catch {
    Write-Host "Lock: present"
  }
} else {
  Write-Host "Lock: none"
}

if (Test-Path $pidPath) {
  $pidRaw = (Get-Content -LiteralPath $pidPath | Select-Object -First 1)
  if ($pidRaw -as [int]) {
    $procId = [int]$pidRaw
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) {
      Write-Host ("dev:keep:bg pid={0} ({1})" -f $procId, $p.ProcessName)
    } else {
      Write-Host ("dev:keep:bg pid file exists but process not running (pid={0})" -f $procId)
    }
  } else {
    Write-Host "dev:keep:bg pid file exists but is invalid"
  }
} else {
  Write-Host "dev:keep:bg pid file not found"
}

try {
  $tcp4 = Test-NetConnection 127.0.0.1 -Port $Port
  Write-Host ("TCP 127.0.0.1:{0} = {1}" -f $Port, $tcp4.TcpTestSucceeded)
} catch {
  Write-Host ("TCP 127.0.0.1:{0} = (error)" -f $Port)
}

try {
  $tcpl = Test-NetConnection localhost -Port $Port
  Write-Host ("TCP localhost:{0} = {1}" -f $Port, $tcpl.TcpTestSucceeded)
} catch {
  Write-Host ("TCP localhost:{0} = (error)" -f $Port)
}

try {
  $listenLine = (netstat -ano -p tcp | Select-String -Pattern (":$Port\s+") | Select-String -Pattern "LISTENING" | Select-Object -First 1).Line
  if ($listenLine) {
    $parts = ($listenLine -split '\s+') | Where-Object { $_ }
    $listenPid = $parts[-1]
    Write-Host ("LISTEN pid: {0}" -f $listenPid)
  }
} catch {
}

$urls = @(
  "http://127.0.0.1:$Port$HealthPath",
  "http://localhost:$Port$HealthPath"
)

foreach ($url in $urls) {
  Write-Host ("Health: {0}" -f $url)
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
