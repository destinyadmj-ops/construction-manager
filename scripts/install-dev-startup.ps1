param(
  [string]$ShortcutName = "MasterHub Dev Server (dev-keep-bg).lnk"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$cmdPath = Join-Path $repoRoot 'run-dev-keep-bg.cmd'

if (-not (Test-Path $cmdPath)) {
  throw "run-dev-keep-bg.cmd not found: $cmdPath"
}

$startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
if (-not (Test-Path $startupDir)) {
  throw "Startup folder not found: $startupDir"
}

$oldNames = @(
  'MasterHub Dev Server (dev-keep).lnk'
)
foreach ($n in $oldNames) {
  $oldPath = Join-Path $startupDir $n
  if (Test-Path $oldPath) {
    Remove-Item -Force $oldPath
  }
}

$shortcutPath = Join-Path $startupDir $ShortcutName

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)

# Use cmd.exe so .cmd runs reliably, and keep working directory in repo root.
$shortcut.TargetPath = "$env:WINDIR\System32\cmd.exe"
$shortcut.Arguments = "/c """"$cmdPath"""""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle = 1
$shortcut.Description = 'Auto-start Master Hub dev server (dev:keep:bg) on logon'
$shortcut.Save()

Write-Host "Installed startup shortcut: $shortcutPath"
Write-Host "It will run at next logon."