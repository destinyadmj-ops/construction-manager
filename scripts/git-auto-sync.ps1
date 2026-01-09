# Git Auto Sync Script
# 定期的にGitの変更を自動同期（pull → commit → push）

param(
    [int]$IntervalMinutes = 5,
    [switch]$Once,
    [string]$Branch = "fix/site-list-compact-8cols",
    [string]$CommitPrefix = "Auto-sync"
)

$ErrorActionPreference = "Continue"

function Write-ColorLog {
    param($Message, $Color = "White")
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message" -ForegroundColor $Color
}

function Sync-Git {
    Write-ColorLog "=== Git Auto Sync Start ===" -Color Cyan

    # 現在のブランチ確認
    $currentBranch = git rev-parse --abbrev-ref HEAD
    Write-ColorLog "Current branch: $currentBranch" -Color Yellow

    # リモートから最新取得（fetch）
    Write-ColorLog "Fetching from remote..." -Color Yellow
    git fetch origin 2>&1 | Out-Null

    # リモートとの差分確認
    $behind = git rev-list HEAD..origin/$currentBranch --count 2>$null
    if ($behind -gt 0) {
        Write-ColorLog "Remote has $behind new commits. Pulling..." -Color Green
        
        # Stash current changes if any
        $hasChanges = git status --porcelain
        if ($hasChanges) {
            Write-ColorLog "Stashing local changes..." -Color Yellow
            git stash push -m "Auto-sync stash $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" 2>&1 | Out-Null
        }

        # Pull with rebase
        $pullResult = git pull --rebase origin $currentBranch 2>&1
        
        if ($LASTEXITCODE -ne 0) {
            Write-ColorLog "Pull failed! Conflict detected." -Color Red
            Write-ColorLog $pullResult -Color Red
            
            # Abort rebase if conflict
            git rebase --abort 2>&1 | Out-Null
            
            # Restore stash if we stashed
            if ($hasChanges) {
                git stash pop 2>&1 | Out-Null
            }
            
            Write-ColorLog "Please resolve conflicts manually." -Color Red
            return $false
        }

        # Restore stash if we stashed
        if ($hasChanges) {
            Write-ColorLog "Restoring stashed changes..." -Color Yellow
            $stashResult = git stash pop 2>&1
            
            if ($LASTEXITCODE -ne 0) {
                Write-ColorLog "Stash pop failed! Conflict detected." -Color Red
                Write-ColorLog $stashResult -Color Red
                Write-ColorLog "Please resolve conflicts manually." -Color Red
                return $false
            }
        }

        Write-ColorLog "Pull completed successfully." -Color Green
    } else {
        Write-ColorLog "Already up to date with remote." -Color Green
    }

    # ローカル変更確認
    $status = git status --porcelain
    
    if ($status) {
        Write-ColorLog "Local changes detected. Committing..." -Color Yellow
        
        # Untracked files を除外（.zip等）
        $filesToAdd = git status --porcelain | Where-Object { 
            $_ -notmatch '\.zip$' -and 
            $_ -notmatch 'node_modules/' -and
            $_ -notmatch '\.next/' -and
            $_ -notmatch '\.log$' -and
            $_ -notmatch '-err\.txt$' -and
            $_ -notmatch '-out\.txt$'
        }
        
        if ($filesToAdd) {
            git add -A
            
            # Generate commit message
            $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            $commitMsg = "$CommitPrefix`: $timestamp"
            
            git commit -m $commitMsg 2>&1 | Out-Null
            
            if ($LASTEXITCODE -eq 0) {
                Write-ColorLog "Changes committed: $commitMsg" -Color Green
                
                # Push to remote
                Write-ColorLog "Pushing to remote..." -Color Yellow
                $pushResult = git push origin $currentBranch 2>&1
                
                if ($LASTEXITCODE -eq 0) {
                    Write-ColorLog "Push completed successfully." -Color Green
                } else {
                    Write-ColorLog "Push failed!" -Color Red
                    Write-ColorLog $pushResult -Color Red
                    return $false
                }
            } else {
                Write-ColorLog "Commit failed (possibly nothing to commit)." -Color Yellow
            }
        } else {
            Write-ColorLog "No significant changes to commit (only ignored files)." -Color Yellow
        }
    } else {
        Write-ColorLog "No local changes to commit." -Color Green
    }

    Write-ColorLog "=== Git Auto Sync Complete ===" -Color Cyan
    return $true
}

# Main execution
if ($Once) {
    # Run once
    Sync-Git
} else {
    # Run continuously
    Write-ColorLog "Starting Git Auto Sync (interval: $IntervalMinutes minutes)" -Color Cyan
    Write-ColorLog "Press Ctrl+C to stop" -Color Yellow
    
    while ($true) {
        Sync-Git
        
        # Wait for next interval
        $seconds = $IntervalMinutes * 60
        Write-ColorLog "Waiting $IntervalMinutes minutes until next sync..." -Color DarkGray
        Start-Sleep -Seconds $seconds
    }
}
