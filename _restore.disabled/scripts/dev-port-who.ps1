param(
  [int]$Port = 3000
)

$ErrorActionPreference = 'Continue'

if (-not $PSBoundParameters.ContainsKey('Port')) {
  $envPort = $env:PORT
  if ($envPort -and ($envPort -as [int])) {
    $Port = [int]$envPort
  }
}

Write-Host "== Port $Port listeners =="

# Prefer Get-NetTCPConnection when available (more reliable than parsing netstat output).
try {
  $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop
  if ($conns -and $conns.Count -gt 0) {
    $pids = $conns | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
    foreach ($procId in $pids) {
      try {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) {
          $path = $null
          try { $path = $p.Path } catch { }
          Write-Host ("pid={0} name={1} path={2}" -f $procId, $p.ProcessName, $path)
        } else {
          Write-Host ("pid={0} (process not found)" -f $procId)
        }
      } catch {
        Write-Host ("pid={0} (error: {1})" -f $procId, $_.Exception.Message)
      }
    }
    exit 0
  }
} catch {
  # fall back to netstat parsing below
}

$lines = @()
try {
  $lines = netstat -ano -p tcp | Select-String -Pattern ":$Port\s+" | Select-String -Pattern "LISTENING" | ForEach-Object { $_.Line }
} catch {
  $lines = @()
}

if (-not $lines -or $lines.Count -eq 0) {
  Write-Host "No TCP LISTENING found."
  exit 0
}

$pids = @()
foreach ($l in $lines) {
  $parts = ($l -split '\s+') | Where-Object { $_ }
  $procId = $parts[-1]
  if ($procId -as [int]) { $pids += [int]$procId }
}

$pids = $pids | Sort-Object -Unique
foreach ($procId in $pids) {
  try {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) {
      $path = $null
      try { $path = $p.Path } catch { }
      Write-Host ("pid={0} name={1} path={2}" -f $procId, $p.ProcessName, $path)
    } else {
      Write-Host ("pid={0} (process not found)" -f $procId)
    }
  } catch {
    Write-Host ("pid={0} (error: {1})" -f $procId, $_.Exception.Message)
  }
}
