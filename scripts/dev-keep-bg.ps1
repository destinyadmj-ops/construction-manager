param(
  [string]$LogFile = "dev-keep.log",
  [string]$PidFile = "dev-keep.pid",
  [int]$Port = 3000,
  [string]$HealthPath = "/api/health",
  [int]$TimeoutSec = 1
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$devKeep = Join-Path $PSScriptRoot 'dev-keep.ps1'
$healthScript = Join-Path $PSScriptRoot 'dev-health.ps1'

if (-not (Test-Path $devKeep)) {
  throw "dev-keep.ps1 not found: $devKeep"
}

if (Test-Path $healthScript) {
  $envPort = $env:PORT
  if (-not $PSBoundParameters.ContainsKey('Port') -and $envPort -and ($envPort -as [int])) {
    $Port = [int]$envPort
  }
}

$existingPidPath = Join-Path $repoRoot $PidFile
if (Test-Path $existingPidPath) {
  try {
    $procIdRaw = Get-Content -LiteralPath $existingPidPath -ErrorAction Stop | Select-Object -First 1
    if ($procIdRaw -and ($procIdRaw -as [int])) {
      $procId = [int]$procIdRaw
      $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($p) {
        Write-Host "Already running (pid=$procId)."
        exit 0
      }
      Remove-Item -Force $existingPidPath -ErrorAction SilentlyContinue
    }
  } catch {
    # ignore
  }
}

# If health is already OK but keeper is not running, we still start dev-keep in background.
# dev-keep.ps1 itself will avoid double-start by checking /api/health before launching next dev.
if (Test-Path $healthScript) {
  $urls = @(
    "http://127.0.0.1:$Port$HealthPath",
    "http://localhost:$Port$HealthPath"
  )

  foreach ($url in $urls) {
    try {
      $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec $TimeoutSec -Uri $url
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
        Write-Host "Health OK ($url) (starting keeper anyway)."
        break
      }
    } catch {
      # not healthy
    }
  }
}

$argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$devKeep`" -LogFile `"$LogFile`" -Port $Port -HealthPath `"$HealthPath`""

$proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru

Start-Sleep -Milliseconds 600
if ($proc.HasExited) {
  # dev-keep.ps1 は「既に起動中」の場合 exit 0 で即終了する。
  # そのケースは失敗ではないので成功扱いにする。
  if ($proc.ExitCode -eq 0) {
    Write-Host "dev:keep already running."
    exit 0
  }

  Write-Host "Failed to start dev:keep in background."
  Write-Host "Check log: $(Join-Path $repoRoot $LogFile)"
  exit 1
}

Set-Content -LiteralPath (Join-Path $repoRoot $PidFile) -Value $proc.Id -Encoding ascii
Write-Host "Started dev:keep in background (pid=$($proc.Id))."