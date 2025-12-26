param(
  [int]$Port = 3000,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

function Write-Info([string]$msg) { Write-Host $msg }
function Write-Warn([string]$msg) { Write-Warning $msg }

function Stop-ProcessSafe([int]$procId, [string]$reason) {
  if (-not $procId) { return }
  try {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($null -eq $p) { return }

    if (-not $Force) {
      Write-Warn ("Refusing to stop pid={0} ({1}) without -Force. Reason: {2}" -f $procId, $p.ProcessName, $reason)
      return
    }

    Write-Info ("Stopping pid={0} ({1}). Reason: {2}" -f $procId, $p.ProcessName, $reason)
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  } catch {
    # ignore
  }
}

Write-Info ("Repo: {0}" -f $repoRoot)
Write-Info ("Target port: {0}" -f $Port)

# 1) Stop background dev:keep (pid file) if present
$pidPath = Join-Path $repoRoot 'dev-keep.pid'
if (Test-Path $pidPath) {
  try {
    $pidRaw = (Get-Content -LiteralPath $pidPath -ErrorAction Stop | Select-Object -First 1)
    if ($pidRaw -as [int]) {
      Stop-ProcessSafe -procId ([int]$pidRaw) -reason 'dev-keep.bg pid file'
    }
  } catch {
    # ignore
  }

  if ($Force) {
    Remove-Item -Force $pidPath -ErrorAction SilentlyContinue
  }
}

# 2) Stop any PowerShell processes running dev-keep.ps1 for this repo
try {
  Write-Info 'Scanning keeper processes (PowerShell)...'
  $keepers = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" | Where-Object {
    $_.CommandLine -and
    $_.CommandLine -like '*\\scripts\\dev-keep.ps1*' -and
    $_.CommandLine -like ("*{0}*" -f $repoRoot)
  }

  foreach ($k in $keepers) {
    Stop-ProcessSafe -procId $k.ProcessId -reason 'dev-keep.ps1 keeper'
  }
} catch {
  # ignore
}

# 3) Stop the process currently LISTENing on the port (only if it looks like Next.js for this repo)
try {
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  foreach ($l in $listeners) {
    $pid = $l.OwningProcess
    if (-not $pid) { continue }

    $cmd = ''
    try {
      $cmd = (Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $pid)).CommandLine
    } catch {
      $cmd = ''
    }

    $looksLikeRepoNext = $false
    if ($cmd) {
      $looksLikeRepoNext = (
        $cmd -like '*\\node_modules\\next\\dist\\server\\lib\\start-server.js*' -and
        $cmd -like ("*{0}*" -f $repoRoot)
      )
    }

    if ($looksLikeRepoNext) {
      Stop-ProcessSafe -procId $pid -reason ("port {0} listener (Next.js)" -f $Port)
    } else {
      if ($Force) {
        Write-Warn ("pid={0} is listening on port {1} but does not look like this repo's Next.js; leaving it running." -f $pid, $Port)
      }
    }
  }
} catch {
  # ignore
}

# 4) Remove Next.js dev lock (stale lock can block restarts)
$lockPath = Join-Path $repoRoot '.next\dev\lock'
if (Test-Path $lockPath) {
  if ($Force) {
    Remove-Item -Force $lockPath -ErrorAction SilentlyContinue
    Write-Info ("Removed lock: {0}" -f $lockPath)
  } else {
    Write-Warn ("Lock exists: {0} (use -Force to remove)" -f $lockPath)
  }
}

# 5) Confirm port state
try {
  $still = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if ($still) {
    Write-Warn ("Port {0} is still listening." -f $Port)
    if (-not $Force) {
      Write-Info 'Re-run with: npm run dev:stop:hard -- -Force'
    }
    exit 1
  }
} catch {
}

Write-Info 'OK: stopped dev processes (as applicable).'
exit 0
