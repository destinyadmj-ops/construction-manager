param(
  [string]$ShortcutName = "MasterHub Dev Server (dev-keep-bg).lnk"
)

$ErrorActionPreference = 'Stop'

$startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'

$candidates = @(
  $ShortcutName,
  'MasterHub Dev Server (dev-keep).lnk'
)

$removedAny = $false
foreach ($name in $candidates) {
  $p = Join-Path $startupDir $name
  if (Test-Path $p) {
    Remove-Item -Force $p
    Write-Host "Removed startup shortcut: $p"
    $removedAny = $true
  }
}

if (-not $removedAny) {
  Write-Host "Startup shortcut not found."
}

Write-Host "Done."