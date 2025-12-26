param(
  [string]$Spec = "e2e/smoke.spec.ts",
  [string]$Reporter = "line"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$picker = Join-Path $PSScriptRoot 'pick-port.ps1'
$port = & powershell -NoProfile -ExecutionPolicy Bypass -File $picker -Candidates @(3000, 3001) -HealthPath "/api/health" -TimeoutMs 700
if (-not $port -or -not ($port -as [int])) {
  $port = 3000
}
$port = [int]$port

Write-Host ("[INFO] Auto-picked PW_PORT: {0}" -f $port)
$env:PW_PORT = "$port"

# Run Playwright directly so output is visible.
& npx playwright test $Spec --reporter=$Reporter
exit $LASTEXITCODE
