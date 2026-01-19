param(
  [int]$DelaySeconds = 3,
  [string]$LogFile = "dev-keep.log",
  [int]$Port = 3000,
  [string]$HealthPath = "/api/health",
  [int]$HealthTimeoutMs = 800,
  [int]$IdleCheckSeconds = 2,
  [int]$StaleLockSeconds = 600
)

$ErrorActionPreference = 'Stop'

if (-not $PSBoundParameters.ContainsKey('Port')) {
  $envPort = $env:PORT
  if ($envPort -and ($envPort -as [int])) {
    $Port = [int]$envPort
  }
}

# Single-instance guard (per port). Prevents multiple dev-keep processes from
# racing to start/restart next dev and causing Next.js lock acquisition errors.
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$lockDir = Join-Path $repoRoot '.dev\locks'
New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
$guardPath = Join-Path $lockDir ("dev-keep-{0}.lock" -f $Port)

try {
  $global:DevKeepGuardStream = [System.IO.File]::Open(
    $guardPath,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )

  $global:DevKeepGuardStream.SetLength(0)
  $guardWriter = New-Object System.IO.StreamWriter($global:DevKeepGuardStream, [System.Text.Encoding]::UTF8, 1024, $true)
  $guardWriter.WriteLine(("pid={0}" -f $PID))
  $guardWriter.WriteLine(("port={0}" -f $Port))
  $guardWriter.WriteLine(("startedAt={0:o}" -f (Get-Date)))
  $guardWriter.Flush()
} catch {
  Write-Host ("[INFO] dev-keep already running for port {0}. Exiting." -f $Port)
  exit 0
}

Write-Host "Starting dev server with auto-restart..."
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

function Test-DevHealth {
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

function Stop-StuckNextDev {
  try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Where-Object {
        $_.CommandLine -and
        $_.CommandLine -like '*next*dev*' -and
        $_.CommandLine -like '*master-hub*'
      }

    foreach ($proc in $procs) {
      try {
        Write-LogLine ("Stopping stuck next dev pid={0}" -f $proc.ProcessId)
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
      } catch {
      }
    }
  } catch {
  }
}

while ($true) {
  try {
    if (Test-DevHealth) {
      Write-LogLine "HEALTH ok (already running). Waiting..."
      Start-Sleep -Seconds $IdleCheckSeconds
      continue
    }

    $lockPath = Join-Path (Join-Path $PSScriptRoot '..') '.next\\dev\\lock'
    if (Test-Path $lockPath) {
      try {
        $ageSec = (New-TimeSpan -Start (Get-Item $lockPath).LastWriteTime -End (Get-Date)).TotalSeconds
        if ($ageSec -ge $StaleLockSeconds) {
          Write-LogLine ("LOCK stale ({0:n0}s). Attempting recovery..." -f $ageSec)
          Stop-StuckNextDev
          Write-LogLine ("Removing lock: {0}" -f $lockPath)
          Remove-Item -Force $lockPath -ErrorAction SilentlyContinue
        } else {
          Write-LogLine ("LOCK present ({0:n0}s). Assuming another next dev is starting. Waiting..." -f $ageSec)
          Start-Sleep -Seconds $IdleCheckSeconds
          continue
        }
      } catch {
        Write-LogLine "LOCK present. Waiting..."
        Start-Sleep -Seconds $IdleCheckSeconds
        continue
      }
    }

    Write-LogLine ("START npm run dev -- -p {0}" -f $Port)

    # Run in-process for reliability on Windows.
    # Tee-Object has no -Encoding on Windows PowerShell 5.1, so we append via Out-File (UTF-8) ourselves.
    npm.cmd run dev -- -p $Port 2>&1 | ForEach-Object {
      $_ | Out-File -FilePath $LogFile -Append -Encoding utf8
      $_
    }

    $code = $LASTEXITCODE
    Write-LogLine "EXIT code=$code"
  } catch {
    Write-LogLine "ERROR (dev-keep)"
    Write-LogLine ($_.Exception.ToString())
    $code = 1
  }

  Write-Host "Dev server exited (code=$code). Restarting in $DelaySeconds sec..."
  Start-Sleep -Seconds $DelaySeconds
}
