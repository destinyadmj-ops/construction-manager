param(
  [string]$LogFile = "start-keep.log",
  [string]$PidFile = "start-keep.pid",
  [int]$Port = 3001,
  [string]$HealthPath = "/api/health",
  [int]$TimeoutSec = 1
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$startKeep = Join-Path $PSScriptRoot 'start-keep.ps1'

if (-not (Test-Path $startKeep)) {
  throw "start-keep.ps1 not found: $startKeep"
}

$pidPath = Join-Path $repoRoot $PidFile
if (Test-Path $pidPath) {
  try {
    $procIdRaw = Get-Content -LiteralPath $pidPath -ErrorAction Stop | Select-Object -First 1
    if ($procIdRaw -and ($procIdRaw -as [int])) {
      $procId = [int]$procIdRaw
      $process = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($process) {
        Write-Host "Already running (pid=$procId)."
        exit 0
      }
      Remove-Item -Force $pidPath -ErrorAction SilentlyContinue
    }
  } catch {
    # ignore
  }
}

$argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$startKeep`" -LogFile `"$LogFile`" -Port $Port -HealthPath `"$HealthPath`""
$proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru

Start-Sleep -Milliseconds 600
if ($proc.HasExited) {
  if ($proc.ExitCode -eq 0) {
    Write-Host 'start:keep already running.'
    exit 0
  }

  Write-Host 'Failed to start start:keep in background.'
  Write-Host "Check log: $(Join-Path $repoRoot $LogFile)"
  exit 1
}

Set-Content -LiteralPath $pidPath -Value $proc.Id -Encoding ascii
Write-Host "Started start:keep in background (pid=$($proc.Id))."