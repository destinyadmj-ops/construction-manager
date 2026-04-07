param(
    [int]$PullIntervalMinutes = 5,
    [int]$DebounceSeconds = 90,
    [int]$PollSeconds = 5
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$startupInstaller = Join-Path $PSScriptRoot 'install-git-sync-startup.ps1'

if (-not (Test-Path $startupInstaller)) {
    throw "install-git-sync-startup.ps1 not found: $startupInstaller"
}

Write-Host 'Applying repository-local git sync settings...'
git -C $repoRoot config pull.rebase true
git -C $repoRoot config rebase.autoStash true
git -C $repoRoot config fetch.prune true
git -C $repoRoot config rerere.enabled true

Write-Host 'Installing startup shortcut...'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startupInstaller -PullIntervalMinutes $PullIntervalMinutes -DebounceSeconds $DebounceSeconds -PollSeconds $PollSeconds
if ($LASTEXITCODE -ne 0) {
    throw 'Startup shortcut installation failed.'
}

Write-Host 'Git sync setup completed for this machine.'
Write-Host 'Run the same command on the other PC to match the setup.'