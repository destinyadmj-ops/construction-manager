# Git Auto Sync Script
# 定期的に Git の fetch を行い、安全なときだけ pull --rebase を実行する

param(
    [int]$IntervalMinutes = 5,
    [switch]$Once,
    [string]$Branch = "",
    [string]$LogFile = ".dev/git-auto-sync.log"
)

$ErrorActionPreference = "Continue"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$gitDir = Join-Path $repoRoot '.git'
$operationMutex = New-Object System.Threading.Mutex($false, 'Local\MasterHubGitSyncOps')
$loopMutex = New-Object System.Threading.Mutex($false, 'Local\MasterHubGitAutoSyncLoop')
$hasLoopMutex = $false
$logPath = if ([System.IO.Path]::IsPathRooted($LogFile)) { $LogFile } else { Join-Path $repoRoot $LogFile }
$logDir = Split-Path -Parent $logPath
if ($logDir -and -not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-ColorLog {
    param($Message, $Color = 'White')

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$timestamp] $Message"
    Write-Host $line -ForegroundColor $Color
    Add-Content -Path $logPath -Value $line
}

function Get-StatusPathFromLine {
    param([string]$Line)

    if ([string]::IsNullOrWhiteSpace($Line) -or $Line.Length -lt 4) {
        return ''
    }

    $pathPart = $Line.Substring(3).Trim()
    if ($pathPart -match ' -> ') {
        $pathPart = ($pathPart -split ' -> ')[-1]
    }

    return $pathPart.Trim('"')
}

function Test-IgnoredStatusPath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $true
    }

    $ignoredPatterns = @(
        '^dev-keep\.pid$'
        '^dev-keep\.log$'
        '^latest\.log$'
        '^\.dev/'
        '^node_modules/'
        '^\.next/'
        '^coverage/'
        '^test-results/'
        '^playwright-report/'
        '^apps/twa/android/app/build/'
        '\.log(\..+)?$'
        '\.bak$'
        '-err\.txt$'
        '-out\.txt$'
    )

    foreach ($pattern in $ignoredPatterns) {
        if ($Path -match $pattern) {
            return $true
        }
    }

    return $false
}

function Get-MeaningfulStatusLines {
    $statusLines = @(git -C $repoRoot status --porcelain 2>$null)
    $meaningful = @()

    foreach ($line in $statusLines) {
        $path = Get-StatusPathFromLine $line
        if (-not (Test-IgnoredStatusPath $path)) {
            $meaningful += $line
        }
    }

    return $meaningful
}

function Test-GitOperationInProgress {
    $markers = @(
        'MERGE_HEAD'
        'CHERRY_PICK_HEAD'
        'REVERT_HEAD'
        'BISECT_LOG'
        'rebase-merge'
        'rebase-apply'
    )

    foreach ($marker in $markers) {
        if (Test-Path (Join-Path $gitDir $marker)) {
            return $true
        }
    }

    return $false
}

function Invoke-WithGitSyncLock {
    param([scriptblock]$ScriptBlock)

    if (-not $operationMutex.WaitOne(0)) {
        Write-ColorLog 'Another git sync operation is already running. Skipping this cycle.' 'DarkGray'
        return $false
    }

    try {
        & $ScriptBlock
        return $true
    } finally {
        $operationMutex.ReleaseMutex() | Out-Null
    }
}

function Sync-Git {
    Write-ColorLog '=== Git Auto Sync Start ===' 'Cyan'

    $currentBranch = if ([string]::IsNullOrWhiteSpace($Branch)) {
        (git -C $repoRoot rev-parse --abbrev-ref HEAD 2>$null).Trim()
    } else {
        $Branch
    }

    if ([string]::IsNullOrWhiteSpace($currentBranch) -or $currentBranch -eq 'HEAD') {
        Write-ColorLog 'Skipping sync because the repository is in detached HEAD state.' 'Yellow'
        return $false
    }

    Write-ColorLog "Current branch: $currentBranch" 'Yellow'
    Write-ColorLog 'Fetching from remote...' 'Yellow'
    $fetchResult = git -C $repoRoot fetch origin 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-ColorLog 'Fetch failed.' 'Red'
        Write-ColorLog ($fetchResult -join [Environment]::NewLine) 'Red'
        return $false
    }

    git -C $repoRoot show-ref --verify --quiet "refs/remotes/origin/$currentBranch"
    if ($LASTEXITCODE -ne 0) {
        Write-ColorLog "Remote tracking branch origin/$currentBranch was not found. Fetch only completed." 'Yellow'
        return $true
    }

    $counts = (git -C $repoRoot rev-list --left-right --count "HEAD...origin/$currentBranch" 2>$null).Trim()
    if ([string]::IsNullOrWhiteSpace($counts)) {
        Write-ColorLog 'Could not determine ahead/behind counts. Fetch only completed.' 'Yellow'
        return $true
    }

    $parts = $counts -split '\s+'
    $ahead = [int]$parts[0]
    $behind = [int]$parts[1]

    if ($behind -gt 0) {
        if (Test-GitOperationInProgress) {
            Write-ColorLog "Remote is $behind commit(s) ahead, but another git operation is in progress. Skipping auto-pull." 'Yellow'
        } else {
            $meaningfulChanges = Get-MeaningfulStatusLines
            if ($meaningfulChanges.Count -gt 0) {
                Write-ColorLog "Remote is $behind commit(s) ahead, but meaningful local changes exist. Skipping auto-pull." 'Yellow'
            } else {
                Write-ColorLog "Remote has $behind new commit(s). Pulling with rebase..." 'Green'
                $pullResult = git -C $repoRoot pull --rebase --autostash origin $currentBranch 2>&1
                if ($LASTEXITCODE -ne 0) {
                    Write-ColorLog 'Pull failed.' 'Red'
                    Write-ColorLog ($pullResult -join [Environment]::NewLine) 'Red'
                    git -C $repoRoot rebase --abort 2>&1 | Out-Null
                    return $false
                }

                Write-ColorLog 'Pull completed successfully.' 'Green'
            }
        }
    } else {
        Write-ColorLog 'Remote is already up to date.' 'Green'
    }

    if ($ahead -gt 0) {
        Write-ColorLog "Local branch is $ahead commit(s) ahead of origin/$currentBranch." 'Yellow'
    }

    Write-ColorLog '=== Git Auto Sync Complete ===' 'Cyan'
    return $true
}

try {
    if (-not $Once) {
        $hasLoopMutex = $loopMutex.WaitOne(0)
        if (-not $hasLoopMutex) {
            Write-ColorLog 'Git auto sync is already running. Exiting duplicate process.' 'DarkGray'
            exit 0
        }
    }

    if ($Once) {
        Invoke-WithGitSyncLock { Sync-Git | Out-Null } | Out-Null
    } else {
        Write-ColorLog "Starting Git Auto Sync (fetch every $IntervalMinutes minutes, pull only when safe)" 'Cyan'
        Write-ColorLog 'Press Ctrl+C to stop' 'Yellow'

        while ($true) {
            Invoke-WithGitSyncLock { Sync-Git | Out-Null } | Out-Null
            Write-ColorLog "Waiting $IntervalMinutes minute(s) until next fetch..." 'DarkGray'
            Start-Sleep -Seconds ($IntervalMinutes * 60)
        }
    }
} finally {
    if ($hasLoopMutex) {
        $loopMutex.ReleaseMutex() | Out-Null
    }
    $loopMutex.Dispose()
    $operationMutex.Dispose()
}
