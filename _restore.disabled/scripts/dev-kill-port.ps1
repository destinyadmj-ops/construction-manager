param(
  [int]$Port = 3000,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not $PSBoundParameters.ContainsKey('Port')) {
  $envPort = $env:PORT
  if ($envPort -and ($envPort -as [int])) {
    $Port = [int]$envPort
  }
}

if ($Port -lt 1 -or $Port -gt 65535) {
  Write-Host "Invalid Port: $Port (must be 1..65535)"
  exit 2
}

if (-not $Force) {
  Write-Host "Listing processes listening on port $Port... (use -Force to stop)"
} else {
  Write-Host "Stopping processes listening on port $Port..."
}

$lines = @()
try {
  $lines = netstat -ano -p tcp | Select-String -Pattern "LISTENING" | ForEach-Object { $_.ToString() }
} catch {
  $lines = @()
}

$pids = @()
foreach ($l in $lines) {
  $parts = ($l -split '\s+') | Where-Object { $_ -ne '' }
  if ($parts.Length -ge 5 -and $parts[0] -eq 'TCP') {
    $local = $parts[1]
    $state = $parts[3]
    $procId = $parts[4]

    if ($state -ne 'LISTENING') { continue }
    if (-not ($local -like "*:$Port")) { continue }
    if ($procId -as [int]) { $pids += [int]$procId }
  }
}

$pids = $pids | Sort-Object -Unique
if ($pids.Count -eq 0) {
  Write-Host "No listeners found on port $Port."
  exit 0
}

if (-not $Force -and $pids.Count -gt 3) {
  Write-Host "Refusing to stop $($pids.Count) processes (use -Force to proceed)."
  $pids | ForEach-Object { Write-Host ("- pid={0}" -f $_) }
  exit 3
}

foreach ($procId in $pids) {
  try {
    if ($procId -eq 0 -or $procId -eq 4) {
      Write-Host ("Skipping protected pid={0}" -f $procId)
      continue
    }
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $name = if ($p) { $p.ProcessName } else { 'unknown' }
    if (-not $Force) {
      Write-Host ("- pid={0} ({1})" -f $procId, $name)
      continue
    }
    Write-Host ("Stopping pid={0} ({1})" -f $procId, $name)
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  } catch {
    # ignore
  }
}

Write-Host "Done."
