param(
  [string]$PidFile = "start-keep.pid",
  [int]$Port = 3001
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $repoRoot $PidFile
$lockPath = Join-Path $repoRoot (".dev\locks\start-keep-{0}.lock" -f $Port)

function Stop-ProcessSafe([int]$ProcessId, [string]$Reason) {
  if (-not $ProcessId) {
    return
  }

  try {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process) {
      return
    }

    Write-Host ("Stopping pid={0} ({1}). Reason: {2}" -f $ProcessId, $process.ProcessName, $Reason)
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  } catch {
    # ignore
  }
}

if (Test-Path $pidPath) {
  try {
    $pidRaw = Get-Content -LiteralPath $pidPath -ErrorAction Stop | Select-Object -First 1
    if ($pidRaw -as [int]) {
      Stop-ProcessSafe -ProcessId ([int]$pidRaw) -Reason 'start-keep pid file'
    }
  } catch {
    # ignore
  }
  Remove-Item -Force $pidPath -ErrorAction SilentlyContinue
}

try {
  $keepers = Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" | Where-Object {
    $_.CommandLine -and (
      ($_.CommandLine -like '*\scripts\start-keep.ps1*' -and $_.CommandLine -like ("*{0}*" -f $repoRoot)) -or
      ($_.CommandLine -like '*\scripts\start-keep-agent.ps1*' -and $_.CommandLine -like ("*{0}*" -f $repoRoot))
    )
  }

  foreach ($keeper in $keepers) {
    Stop-ProcessSafe -ProcessId $keeper.ProcessId -Reason 'start supervision process'
  }
} catch {
  # ignore
}

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

    if ($cmdLine -and $cmdLine -like '*next*start*' -and $cmdLine -like ("*{0}*" -f $repoRoot)) {
      Stop-ProcessSafe -ProcessId $procId -Reason ("port {0} listener (Next.js start)" -f $Port)
    }
  }
} catch {
  # ignore
}

if (Test-Path $lockPath) {
  Remove-Item -Force $lockPath -ErrorAction SilentlyContinue
}

Write-Host 'Stopped start-based supervision processes (as applicable).'
exit 0