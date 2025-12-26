param(
  [string]$BindHost = '127.0.0.1',
  [int]$Port = 3010
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$buildId = Join-Path $repoRoot '.next\BUILD_ID'
if (-not (Test-Path $buildId)) {
  Write-Host '[INFO] .next/BUILD_ID not found -> building'
  & npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host '[INFO] build output found -> skipping build'
}

Write-Host ("[INFO] starting next start at http://{0}:{1}" -f $BindHost, $Port)
& npx next start -H $BindHost -p $Port
exit $LASTEXITCODE
