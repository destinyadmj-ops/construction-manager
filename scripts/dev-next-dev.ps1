param(
  [switch]$Kill,
  [switch]$Force
)

$ErrorActionPreference = 'Continue'

$procs = @()
try {
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
      $_.CommandLine -and
      $_.CommandLine -like '*next*dev*' -and
      $_.CommandLine -like '*master-hub*'
    }
} catch {
  $procs = @()
}

if (-not $procs -or $procs.Count -eq 0) {
  Write-Host "No next dev node.exe found."
  exit 0
}

Write-Host "== next dev processes =="
foreach ($p in $procs) {
  Write-Host ("pid={0} cmd={1}" -f $p.ProcessId, $p.CommandLine)
}

if (-not $Kill) {
  exit 0
}

if (-not $Force) {
  Write-Host "Refusing to kill without -Force."
  exit 2
}

foreach ($p in $procs) {
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host ("Stopped pid={0}" -f $p.ProcessId)
  } catch {
  }
}

exit 0
