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

Write-Host "== Master Hub Dev Doctor =="
Write-Host ("PWD: {0}" -f (Get-Location))
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
Write-Host ("Node: {0}" -f ($(if ($nodeCmd) { $nodeCmd.Source } else { 'not found' })))
Write-Host ("npm : {0}" -f ($(if ($npmCmd) { $npmCmd.Source } else { 'not found' })))
Write-Host ("PORT: {0}" -f $Port)

$repoRoot = Split-Path -Parent $PSScriptRoot
Write-Host ("Repo: {0}" -f $repoRoot)

Write-Host "-- dev:status"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev-status.ps1') -Port $Port

Write-Host "-- listeners"
try {
  netstat -ano | Select-String -Pattern (":$Port\s+") | Select-Object -First 10 | ForEach-Object { $_.ToString() }
} catch {
}

Write-Host "-- hints"
Write-Host "- Start: npm run dev:keep:bg"
Write-Host "- Restart: npm run dev:restart"
Write-Host "- Port owner: npm run dev:port:who"
Write-Host "- Free port (list/kill): npm run dev:kill:port -- -Port 3000 [-Force]"
Write-Host "- Fix stuck (lock/next dev): npm run dev:fix:stuck [-- -Force]"
Write-Host "- Open browser: npm run dev:open"
Write-Host "- Logs: npm run dev:logs:tail / dev:logs:open"
