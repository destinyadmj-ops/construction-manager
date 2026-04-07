param(
    [string]$ShortcutName = 'MasterHub Git Sync Agent.lnk',
    [int]$PullIntervalMinutes = 5,
    [int]$DebounceSeconds = 90,
    [int]$PollSeconds = 5
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$launcherPath = Join-Path $PSScriptRoot 'git-sync-launcher.ps1'

if (-not (Test-Path $launcherPath)) {
    throw "git-sync-launcher.ps1 not found: $launcherPath"
}

$startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
if (-not (Test-Path $startupDir)) {
    throw "Startup folder not found: $startupDir"
}

$shortcutPath = Join-Path $startupDir $ShortcutName
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)

$shortcut.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcherPath`" -PullIntervalMinutes $PullIntervalMinutes -DebounceSeconds $DebounceSeconds -PollSeconds $PollSeconds"
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Auto-start Master Hub git sync loops on logon'
$shortcut.Save()

Write-Host "Installed startup shortcut: $shortcutPath"
Write-Host 'It will start git fetch/pull and save-sync loops at next logon.'