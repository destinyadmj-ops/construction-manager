param(
    [string]$ShortcutName = 'MasterHub Git Sync Agent.lnk'
)

$ErrorActionPreference = 'Stop'

$startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$shortcutPath = Join-Path $startupDir $ShortcutName

if (Test-Path $shortcutPath) {
    Remove-Item -Force $shortcutPath
    Write-Host "Removed startup shortcut: $shortcutPath"
} else {
    Write-Host 'Startup shortcut not found.'
}

Write-Host 'Done.'