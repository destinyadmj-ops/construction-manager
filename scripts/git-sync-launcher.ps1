param(
    [int]$PullIntervalMinutes = 5,
    [int]$DebounceSeconds = 90,
    [int]$PollSeconds = 5
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Start-HiddenGitProcess {
    param(
        [string]$ScriptName,
        [string[]]$Arguments = @()
    )

    $scriptPath = Join-Path $PSScriptRoot $ScriptName
    if (-not (Test-Path $scriptPath)) {
        throw "Script not found: $scriptPath"
    }

    $argumentList = @(
        '-NoProfile'
        '-WindowStyle', 'Hidden'
        '-ExecutionPolicy', 'Bypass'
        '-File', $scriptPath
    ) + $Arguments

    Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentList -WorkingDirectory $repoRoot -WindowStyle Hidden | Out-Null
}

Start-HiddenGitProcess -ScriptName 'git-auto-sync.ps1' -Arguments @('-IntervalMinutes', "$PullIntervalMinutes")
Start-HiddenGitProcess -ScriptName 'git-save-sync.ps1' -Arguments @('-DebounceSeconds', "$DebounceSeconds", '-PollSeconds', "$PollSeconds")

Write-Host 'Git sync background processes launch requested.'