# Stops processes using dev ports, removes .next lock, then starts dev-home
$root = Resolve-Path "$PSScriptRoot\.."
$ports = 3000,3001,3002,3003
$pids = @()
foreach ($p in $ports) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
        if ($conns) { $pids += $conns.OwningProcess }
    } catch { }
}
$pids = $pids | Where-Object { $_ -ne $null } | Sort-Object -Unique
if ($pids.Count -gt 0) {
    foreach ($procId in $pids) {
        try {
            Write-Host "Stopping process $procId (port occupant)"
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Warning ("Failed to stop process {0}: {1}" -f $procId, $_)
        }
    }
} else {
    Write-Host "No processes found using ports: $($ports -join ', ')"
}
# Also stop node.exe instances that may be leftover
$nodes = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodes) {
    foreach ($n in $nodes) {
        if ($pids -notcontains $n.Id) {
            try {
                Write-Host "Stopping node process $($n.Id)"
                Stop-Process -Id $n.Id -Force -ErrorAction SilentlyContinue
            } catch { Write-Warning ("Failed to stop node {0}: {1}" -f $($n.Id), $_) }
        }
    }
}
# Remove Next dev lock file if present
$lock = Join-Path $root ".next\dev\lock"
if (Test-Path $lock) {
    try { Remove-Item $lock -Force; Write-Host "Removed lock file: $lock" } catch { Write-Warning ("Could not remove lock: {0}" -f $_) }
} else {
    Write-Host "No lock file at $lock"
}
# Start dev with .env.home loader
& "$PSScriptRoot\dev-home.ps1"
