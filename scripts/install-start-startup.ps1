param(
  [string]$ShortcutName = "MasterHub Production Server (start-keep-agent).lnk"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$cmdPath = Join-Path $repoRoot 'run-start-keep-agent.cmd'

if (-not (Test-Path $cmdPath)) {
  throw "run-start-keep-agent.cmd not found: $cmdPath"
}

$startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
if (-not (Test-Path $startupDir)) {
  throw "Startup folder not found: $startupDir"
}

$shortcutPath = Join-Path $startupDir $ShortcutName
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)

$shortcut.TargetPath = "$env:WINDIR\System32\cmd.exe"
$shortcut.Arguments = "/c """"$cmdPath"""""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle = 1
$shortcut.Description = 'Auto-start Master Hub production server supervisor on logon'
$shortcut.Save()

Write-Host "Installed startup shortcut: $shortcutPath"
Write-Host 'It will run at next logon.'