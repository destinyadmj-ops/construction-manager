param(
  [int]$Port = 3001
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host ("[INFO] build (prod)")
& npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'show-lan-url.ps1') -Port $Port -Path '/?mode=week' -CopyFirst
} catch {
  # ignore
}

Write-Host ("[INFO] start (LAN): http://0.0.0.0:{0} (access via one of the URLs above)" -f $Port)
& npx next start -H 0.0.0.0 -p $Port
exit $LASTEXITCODE
