$ErrorActionPreference = 'Stop'

Write-Host 'Refreshing startup shortcut (bg)...'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'uninstall-dev-startup.ps1')
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'install-dev-startup.ps1')
Write-Host 'Done.'
