param(
  [int]$DelaySeconds = 10,
  [string]$LogFile = "start-keep.log",
  [int]$Port = 3001,
  [string]$HealthPath = "/api/health",
  [int]$HealthTimeoutMs = 1000,
  [int]$IdleCheckSeconds = 5,
  [string]$BuildStateFile = ".dev/start-build-state.json",
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

if (-not $PSBoundParameters.ContainsKey('Port')) {
  $envPort = $env:PORT
  if ($envPort -and ($envPort -as [int])) {
    $Port = [int]$envPort
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$devDir = Join-Path $repoRoot '.dev'
$lockDir = Join-Path $devDir 'locks'
New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
$guardPath = Join-Path $lockDir ("start-keep-{0}.lock" -f $Port)
$buildStatePath = if ([System.IO.Path]::IsPathRooted($BuildStateFile)) { $BuildStateFile } else { Join-Path $repoRoot $BuildStateFile }
$buildStateDir = Split-Path -Parent $buildStatePath
if ($buildStateDir -and -not (Test-Path $buildStateDir)) {
  New-Item -ItemType Directory -Force -Path $buildStateDir | Out-Null
}

try {
  $global:StartKeepGuardStream = [System.IO.File]::Open(
    $guardPath,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )

  $global:StartKeepGuardStream.SetLength(0)
  $guardWriter = New-Object System.IO.StreamWriter($global:StartKeepGuardStream, [System.Text.Encoding]::UTF8, 1024, $true)
  $guardWriter.WriteLine(("pid={0}" -f $PID))
  $guardWriter.WriteLine(("port={0}" -f $Port))
  $guardWriter.WriteLine(("startedAt={0:o}" -f (Get-Date)))
  $guardWriter.Flush()
} catch {
  Write-Host ("[INFO] start-keep already running for port {0}. Exiting." -f $Port)
  exit 0
}

Write-Host "Starting production server with auto-restart..."
Write-Host "- DelaySeconds: $DelaySeconds"
Write-Host "- LogFile: $LogFile"
Write-Host "- Port: $Port"
Write-Host "- HealthPath: $HealthPath"
Write-Host "Press Ctrl+C to stop."

function Write-LogLine {
  param([string]$Line)

  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "[$ts] $Line" | Out-File -FilePath $LogFile -Append -Encoding utf8
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

function Get-CurrentHead {
  $head = (git -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  $headText = ([string]$head).Trim()
  if ([string]::IsNullOrWhiteSpace($headText)) {
    return $null
  }

  return $headText
}

function Read-BuildState {
  if (-not (Test-Path $buildStatePath)) {
    return $null
  }

  try {
    return Get-Content -LiteralPath $buildStatePath -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Save-BuildState {
  $state = [pscustomobject]@{
    port = $Port
    head = Get-CurrentHead
    builtAt = (Get-Date).ToString('o')
  }

  $state | ConvertTo-Json | Set-Content -LiteralPath $buildStatePath -Encoding utf8
}

function Test-BuildRequired {
  if ($SkipBuild) {
    return $false
  }

  $buildIdPath = Join-Path $repoRoot '.next\BUILD_ID'
  if (-not (Test-Path $buildIdPath)) {
    return $true
  }

  $state = Read-BuildState
  if ($null -eq $state) {
    return $true
  }

  $currentHead = Get-CurrentHead
  if ($currentHead -and $state.head -ne $currentHead) {
    return $true
  }

  return $false
}

function Stop-RunningStartProcess {
  try {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
      $procId = $listener.OwningProcess
      if (-not $procId) {
        continue
      }

      $cmdLine = ''
      try {
        $cmdLine = (Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $procId)).CommandLine
      } catch {
        $cmdLine = ''
      }

      $looksLikeRepoStart = $cmdLine -and $cmdLine -like '*next*start*' -and $cmdLine -like ("*{0}*" -f $repoRoot)
      if ($looksLikeRepoStart) {
        Write-LogLine ("Stopping existing next start pid={0}" -f $procId)
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    # ignore
  }
}

function Invoke-Build {
  Write-LogLine 'BUILD npm run build'
  & npm.cmd run build 2>&1 | ForEach-Object {
    $_ | Out-File -FilePath $LogFile -Append -Encoding utf8
    $_
  }

  if ($LASTEXITCODE -eq 0) {
    Save-BuildState
  }

  return $LASTEXITCODE
}

function Invoke-StartCommand {
  & npm.cmd run start -- -H 127.0.0.1 -p $Port 2>&1 | ForEach-Object {
    $_ | Out-File -FilePath $LogFile -Append -Encoding utf8
    $_
  }

  return $LASTEXITCODE
}

$lastHealthy = $null

while ($true) {
  $code = 1
  try {
    $healthy = Test-AppHealth
    if ($healthy) {
      if ($lastHealthy -ne $true) {
        Write-LogLine 'HEALTH ok'
      }
      $lastHealthy = $true

      if (Test-BuildRequired) {
        Write-LogLine 'BUILD state changed. Restarting production server to apply updates...'
        Stop-RunningStartProcess
        Start-Sleep -Seconds 2
      } else {
        Start-Sleep -Seconds $IdleCheckSeconds
        continue
      }
    } else {
      if ($lastHealthy -ne $false) {
        Write-LogLine 'HEALTH missing. Starting production server...'
      }
      $lastHealthy = $false
    }

    if (Test-BuildRequired) {
      $code = Invoke-Build
      if ($code -ne 0) {
        Write-LogLine ("BUILD failed code={0}" -f $code)
        throw "build failed"
      }
    }

    Stop-RunningStartProcess
    Write-LogLine ("START npm run start -- -H 127.0.0.1 -p {0}" -f $Port)
    $code = Invoke-StartCommand
    Write-LogLine ("EXIT code={0}" -f $code)
  } catch {
    Write-LogLine 'ERROR (start-keep)'
    Write-LogLine ($_.Exception.ToString())
  }

  Write-Host "Production server exited (code=$code). Restarting in $DelaySeconds sec..."
  Start-Sleep -Seconds $DelaySeconds
}