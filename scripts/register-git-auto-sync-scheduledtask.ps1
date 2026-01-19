Param(
  [int]$IntervalMinutes = 5,
  [string]$TaskName = 'master-hub-git-auto-sync'
)

# Register a Windows Scheduled Task that runs the existing git-auto-sync.ps1 in this repo every $IntervalMinutes minutes
# Requires: Run as a user with permission to register scheduled tasks

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $repoRoot 'git-auto-sync.ps1'
if (-not (Test-Path $scriptPath)) {
  Write-Error "git-auto-sync.ps1 not found in script directory: $scriptPath"
  exit 1
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -IntervalMinutes $IntervalMinutes"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)
$trigger.RepetitionInterval = (New-TimeSpan -Minutes $IntervalMinutes)
$trigger.RepetitionDuration = ([TimeSpan]::MaxValue)

# Use current user
$user = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel LeastPrivilege

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Description "Auto-sync git changes for master-hub every $IntervalMinutes minutes" -Force
  Write-Host "Scheduled task '$TaskName' registered. It will run every $IntervalMinutes minutes."
  Write-Host "To remove: Unregister-ScheduledTask -TaskName $TaskName -Confirm:
"
} catch {
  Write-Error "Failed to register scheduled task: $_"
  exit 1
}
