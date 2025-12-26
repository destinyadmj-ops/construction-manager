$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Write-Host "Opening: $repoRoot"
Start-Process explorer.exe "`"$repoRoot`""
