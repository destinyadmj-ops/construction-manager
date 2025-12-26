$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent $PSScriptRoot
Write-Host "== Master Hub Dev Info =="
Write-Host ("Repo: {0}" -f $repoRoot)
Write-Host ("PWD : {0}" -f (Get-Location))

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
Write-Host ("Node: {0}" -f ($(if ($nodeCmd) { $nodeCmd.Source } else { 'not found' })))
Write-Host ("npm : {0}" -f ($(if ($npmCmd) { $npmCmd.Source } else { 'not found' })))

$envFile = Join-Path $repoRoot '.env.local'
Write-Host (".env.local: {0}" -f (Test-Path $envFile))

$lockPath = Join-Path $repoRoot '.next\dev\lock'
Write-Host ("lock: {0}" -f (Test-Path $lockPath))
