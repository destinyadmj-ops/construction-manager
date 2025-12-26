param(
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$msg) {
  if (-not $Quiet) { Write-Host $msg }
}

function Write-Warn([string]$msg) {
  Write-Warning $msg
}

function Write-Fail([string]$msg) {
  Write-Host "[ERROR] $msg" -ForegroundColor Red
}

function Is-Windows {
  return $env:OS -eq 'Windows_NT'
}

# Ensure docker CLI exists
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Fail "'docker' command not found. Install Docker Desktop first."
  exit 1
}

# On Windows, Docker Desktop daemon is typically exposed via named pipe.
if (Is-Windows) {
  $pipesToCheck = @(
    '\\.\pipe\docker_engine',
    '\\.\pipe\dockerDesktopLinuxEngine'
  )

  $anyPipe = $false
  foreach ($pipe in $pipesToCheck) {
    if (Test-Path $pipe) { $anyPipe = $true; break }
  }

  if (-not $anyPipe) {
    Write-Warn 'Docker named pipe not found. Docker Desktop may not be running.'
    Write-Info 'Start Docker Desktop, wait ~30s, then retry:'
    Write-Info '  npm run docker:up'
  }
}

# Check daemon reachable (fast)
try {
  docker info *> $null
} catch {
  Write-Fail 'Cannot connect to the Docker daemon. Start Docker Desktop and retry.'
  if ($_.Exception -and $_.Exception.Message) {
    Write-Warn ("docker info error: " + $_.Exception.Message)
  }
  exit 1
}

try {
  Write-Info 'Starting containers (postgres/redis)...'
  docker compose up -d
  Write-Info 'OK: docker compose up -d'
} catch {
  Write-Fail 'docker compose up -d failed. Check Docker Desktop and WSL2 settings.'
  if ($_.Exception -and $_.Exception.Message) {
    Write-Warn ("docker compose error: " + $_.Exception.Message)
  }
  exit 1
}
