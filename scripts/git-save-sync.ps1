param(
    [int]$DebounceSeconds = 90,
    [int]$PollSeconds = 5,
    [int]$RetryCooldownSeconds = 120,
    [string]$CommitPrefix = 'Auto-save sync',
    [string]$LogFile = '.dev/git-save-sync.log'
)

$ErrorActionPreference = 'Continue'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pushScript = Join-Path $PSScriptRoot 'git-push-safe.ps1'
$operationMutex = New-Object System.Threading.Mutex($false, 'Local\MasterHubGitSyncOps')
$loopMutex = New-Object System.Threading.Mutex($false, 'Local\MasterHubGitSaveSyncLoop')
$hasLoopMutex = $false
$script:Initialized = $false
$script:AutoPushArmed = $true
$script:LastSnapshotKey = ''
$script:LastSnapshotChangeTime = Get-Date
$script:LastAttemptedSnapshotKey = ''
$script:LastAttemptTime = [datetime]::MinValue
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
    $gitDir = Join-Path $repoRoot '.git'
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

function Get-LatestActivityTime {
    param(
        [string[]]$StatusLines,
        [datetime]$FallbackTime
    )

    $latest = $FallbackTime
    foreach ($line in $StatusLines) {
        $relativePath = Get-StatusPathFromLine $line
        if ([string]::IsNullOrWhiteSpace($relativePath)) {
            continue
        }

        $absolutePath = Join-Path $repoRoot $relativePath
        if (Test-Path $absolutePath -PathType Leaf) {
            $lastWrite = (Get-Item $absolutePath).LastWriteTime
            if ($lastWrite -gt $latest) {
                $latest = $lastWrite
            }
        }
    }

    return $latest
}

function Invoke-WithGitSyncLock {
    param([scriptblock]$ScriptBlock)

    if (-not $operationMutex.WaitOne(0)) {
        Write-ColorLog 'Another git sync operation is already running. Save-triggered push is deferred.' 'DarkGray'
        return $false
    }

    try {
        & $ScriptBlock
        return $true
    } finally {
        $operationMutex.ReleaseMutex() | Out-Null
    }
}

function Invoke-SafePush {
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $message = "$CommitPrefix`: $timestamp"
    Write-ColorLog "Running git-push-safe with message: $message" 'Green'

    $result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $pushScript -Message $message 2>&1
    foreach ($line in @($result)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$line)) {
            Write-ColorLog ([string]$line) 'Gray'
        }
    }

    return ($LASTEXITCODE -eq 0)
}

try {
    $hasLoopMutex = $loopMutex.WaitOne(0)
    if (-not $hasLoopMutex) {
        Write-ColorLog 'Git save sync is already running. Exiting duplicate process.' 'DarkGray'
        exit 0
    }

    Write-ColorLog "Starting Git Save Sync (debounce: $DebounceSeconds sec, poll: $PollSeconds sec)" 'Cyan'
    Write-ColorLog 'Press Ctrl+C to stop' 'Yellow'

    while ($true) {
        if (Test-GitOperationInProgress) {
            Start-Sleep -Seconds $PollSeconds
            continue
        }

        $statusLines = Get-MeaningfulStatusLines
        if ($statusLines.Count -eq 0) {
            $script:Initialized = $true
            $script:AutoPushArmed = $true
            $script:LastSnapshotKey = ''
            $script:LastAttemptedSnapshotKey = ''
            Start-Sleep -Seconds $PollSeconds
            continue
        }

        $snapshotKey = [string]::Join("`n", $statusLines)
        if ($snapshotKey -ne $script:LastSnapshotKey) {
            if (-not $script:Initialized) {
                $script:AutoPushArmed = $false
                $script:Initialized = $true
                Write-ColorLog 'Existing dirty state found at startup. Waiting for the next new change before auto-push.' 'Yellow'
            } else {
                $script:AutoPushArmed = $true
            }

            $script:LastSnapshotKey = $snapshotKey
            $script:LastSnapshotChangeTime = Get-Date
            Write-ColorLog 'Detected meaningful local changes. Waiting for debounce window...' 'Yellow'
        }

        $latestActivityTime = Get-LatestActivityTime -StatusLines $statusLines -FallbackTime $script:LastSnapshotChangeTime
        $secondsSinceChange = ((Get-Date) - $latestActivityTime).TotalSeconds
        $retryReady = ($snapshotKey -ne $script:LastAttemptedSnapshotKey) -or (((Get-Date) - $script:LastAttemptTime).TotalSeconds -ge $RetryCooldownSeconds)

        if ($script:AutoPushArmed -and $secondsSinceChange -ge $DebounceSeconds -and $retryReady) {
            Invoke-WithGitSyncLock {
                $script:LastAttemptedSnapshotKey = $snapshotKey
                $script:LastAttemptTime = Get-Date

                if (Invoke-SafePush) {
                    Write-ColorLog 'Auto push cycle completed successfully.' 'Green'
                } else {
                    Write-ColorLog 'Auto push cycle failed. It will retry after cooldown or on the next change.' 'Red'
                }
            } | Out-Null
        }

        Start-Sleep -Seconds $PollSeconds
    }
} finally {
    if ($hasLoopMutex) {
        $loopMutex.ReleaseMutex() | Out-Null
    }
    $loopMutex.Dispose()
    $operationMutex.Dispose()
}