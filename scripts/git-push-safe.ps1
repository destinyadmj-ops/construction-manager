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

function Run-Git([string]$args) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'git'
    $psi.Arguments = $args
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    $p.Start() | Out-Null
    $out = $p.StandardOutput.ReadToEnd()
    $err = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    return @{ ExitCode = $p.ExitCode; StdOut = $out; StdErr = $err }
}

Write-Host "Detecting current branch..."
$branchRes = Run-Git 'rev-parse --abbrev-ref HEAD'
if ($branchRes.ExitCode -ne 0) {
    Write-Error "Failed to detect current branch: $($branchRes.StdErr)"
    exit 1
}
$branch = $branchRes.StdOut.Trim()
Write-Host "Current branch: $branch"

Write-Host "Staging all changes..."
$r = Run-Git 'add -A'
if ($r.ExitCode -ne 0) {
    Write-Error "git add failed: $($r.StdErr)"
    exit 1
}

# Check if there is anything to commit
$status = Run-Git 'status --porcelain'
if (-not [string]::IsNullOrWhiteSpace($status.StdOut)) {
    Write-Host "Committing: $Message"
    $commitRes = Run-Git "commit -m \"$Message\""
    if ($commitRes.ExitCode -ne 0) {
        Write-Error "git commit failed: $($commitRes.StdErr)"
        exit 1
    }
} else {
    Write-Host "No changes to commit."
}

Write-Host "Pulling and rebasing from origin/$branch..."
$pullRes = Run-Git "pull --rebase origin $branch"
if ($pullRes.ExitCode -ne 0) {
    Write-Error "git pull --rebase failed. Attempting to abort rebase.\nError:\n$($pullRes.StdErr)"
    # Try to abort rebase if possible
    Run-Git 'rebase --abort' | Out-Null
    Write-Host "Rebase aborted. Please resolve conflicts manually and run the script again."
    exit 1
}

Write-Host "Pushing to origin/$branch..."
$pushRes = Run-Git "push origin $branch"
if ($pushRes.ExitCode -ne 0) {
    Write-Error "git push failed: $($pushRes.StdErr)"
    exit 1
}

Write-Host "Push succeeded."
