param(
  [string]$LogFile = "start-keep.log",
  [int]$Port = 3001,
  [string]$HealthPath = "/api/health",
  [int]$HealthTimeoutMs = 1000,
  [ValidateRange(5, 300)]
  [int]$MonitorIntervalSeconds = 30
)

$ErrorActionPreference = 'Stop'

if (-not $PSBoundParameters.ContainsKey('Port')) {
  $envPort = $env:PORT
  if ($envPort -and ($envPort -as [int])) {
    $Port = [int]$envPort
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$launcherScript = Join-Path $PSScriptRoot 'start-keep-bg.ps1'
$mutexName = "Local\MasterHubStartKeepAgent-$Port"
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$hasMutex = $false

if (-not (Test-Path $launcherScript)) {
  throw "start-keep-bg.ps1 not found: $launcherScript"
}

function Write-LogLine {
  param([string]$Line)

  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  "[$ts] [agent] $Line" | Out-File -FilePath (Join-Path $repoRoot $LogFile) -Append -Encoding utf8
}

function Test-AppHealth {
  $timeoutSec = [Math]::Max(1, [Math]::Ceiling($HealthTimeoutMs / 1000.0))
  $urls = @(
    "http://127.0.0.1:$Port$HealthPath",
    "http://localhost:$Port$HealthPath"
  )

  foreach ($url in $urls) {
    try {
      $res = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec $timeoutSec
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
        return $true
      }
    } catch {
      # keep trying
    }
  }

  return $false
}

function Invoke-EnsureStartKeep {
  $timeoutSec = [Math]::Max(1, [Math]::Ceiling($HealthTimeoutMs / 1000.0))
  $result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcherScript -LogFile $LogFile -Port $Port -HealthPath $HealthPath -TimeoutSec $timeoutSec 2>&1
  foreach ($line in @($result)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$line)) {
      Write-LogLine ([string]$line)
    }
  }

  return $LASTEXITCODE
}

try {
  $hasMutex = $mutex.WaitOne(0)
  if (-not $hasMutex) {
    Write-Host ("start:agent already running for port {0}." -f $Port)
    exit 0
  }

  Write-LogLine ("START pid={0} port={1} interval={2}s" -f $PID, $Port, $MonitorIntervalSeconds)
  $null = Invoke-EnsureStartKeep

  $lastHealthy = $null
  while ($true) {
    try {
      $healthy = Test-AppHealth
      if ($healthy) {
        if ($lastHealthy -ne $true) {
          Write-LogLine 'HEALTH ok'
        }
        $lastHealthy = $true
      } else {
        if ($lastHealthy -ne $false) {
          Write-LogLine 'HEALTH failed. Ensuring start:keep...'
        }
        $lastHealthy = $false
        $null = Invoke-EnsureStartKeep
      }
    } catch {
      Write-LogLine 'ERROR (start-agent)'
      Write-LogLine ($_.Exception.ToString())
    }

    Start-Sleep -Seconds $MonitorIntervalSeconds
  }
} finally {
  if ($hasMutex) {
    $mutex.ReleaseMutex() | Out-Null
  }
  $mutex.Dispose()
}