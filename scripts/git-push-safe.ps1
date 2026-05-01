<#
Safe Git push script for Windows PowerShell

Usage:
  .\scripts\git-push-safe.ps1 -Message "Your commit message"

What it does:
  - Detects current branch
  - Stages all changes
  - Commits if there are staged changes
  - Runs `git pull --rebase origin <branch>` to rebase local commits on top of remote
  - If rebase succeeds, pushes the branch to origin
  - If rebase fails (conflicts), aborts rebase and leaves repository for manual resolution

This helps keep pushes non-destructive and reduces remote conflicts.
#>

param(
    [string]$Message = "WIP: quick update"
)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Get-CurrentBranch {
    $candidates = @(
        @('branch', '--show-current'),
        @('symbolic-ref', '--quiet', '--short', 'HEAD'),
        @('rev-parse', '--abbrev-ref', 'HEAD')
    )

    foreach ($candidate in $candidates) {
        $value = (& git -C $repoRoot @candidate 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -eq 0) {
            $branchName = ([string]$value).Trim()
            if (-not [string]::IsNullOrWhiteSpace($branchName) -and $branchName -ne 'HEAD') {
                return $branchName
            }
        }
    }

    return $null
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

Write-Host 'Detecting current branch...'
$branch = Get-CurrentBranch
if ([string]::IsNullOrWhiteSpace($branch)) {
    Write-Error 'Failed to detect a normal working branch. Confirm that the repository is not in detached HEAD state.'
    exit 1
}
Write-Host "Current branch: $branch"

$statusLines = @(git -C $repoRoot status --porcelain 2>$null)
if ($statusLines.Count -eq 0) {
    Write-Host 'No changes to commit.'
    exit 0
}

$ignoredPaths = @()
foreach ($line in $statusLines) {
    $path = Get-StatusPathFromLine $line
    if (Test-IgnoredStatusPath $path) {
        $ignoredPaths += $path
    }
}
$ignoredPaths = @($ignoredPaths | Sort-Object -Unique)

Write-Host 'Staging changes...'
git -C $repoRoot add -A 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Error 'git add failed.'
    exit 1
}

if ($ignoredPaths.Count -gt 0) {
    git -C $repoRoot restore --staged -- @ignoredPaths 2>$null | Out-Null
}

git -C $repoRoot diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host 'No meaningful staged changes to commit.'
    exit 0
}
if ($LASTEXITCODE -gt 1) {
    Write-Error 'Failed to inspect staged changes.'
    exit 1
}

Write-Host "Committing: $Message"
$commitRes = git -C $repoRoot commit -m $Message 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "git commit failed: $($commitRes -join [Environment]::NewLine)"
    exit 1
}

Write-Host "Pulling and rebasing from origin/$branch..."
$pullRes = git -C $repoRoot pull --rebase --autostash origin $branch 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "git pull --rebase failed. Attempting to abort rebase.\nError:\n$($pullRes -join [Environment]::NewLine)"
    git -C $repoRoot rebase --abort 2>&1 | Out-Null
    Write-Host 'Rebase aborted. Please resolve conflicts manually and run the script again.'
    exit 1
}

Write-Host "Pushing to origin/$branch..."
$pushRes = git -C $repoRoot push origin $branch 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "git push failed: $($pushRes -join [Environment]::NewLine)"
    exit 1
}

Write-Host 'Push succeeded.'
