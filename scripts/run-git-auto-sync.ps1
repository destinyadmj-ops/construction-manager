$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $repoRoot 'git-auto-sync.ps1'
$logDir = Join-Path $repoRoot 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ("git-auto-sync-" + (Get-Date -Format 'yyyyMMdd') + ".log")
$ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
"[$ts] === Git Auto Sync Runner Start ===" | Out-File -FilePath $logFile -Append -Encoding UTF8
try {
  # Run the actual sync script and capture both stdout and stderr
  & $scriptPath -Once 2>&1 | Out-File -FilePath $logFile -Append -Encoding UTF8
  $ts2 = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  "[$ts2] === Git Auto Sync Runner Complete ===" | Out-File -FilePath $logFile -Append -Encoding UTF8
} catch {
  $ts3 = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  "[$ts3] ERROR: $_" | Out-File -FilePath $logFile -Append -Encoding UTF8
  exit 1
}
