# Register a Scheduled Task to run startup-services.ps1 at system startup
# Run this script as Administrator.

$ErrorActionPreference = 'Stop'

$scriptPath = "$(Resolve-Path "$PSScriptRoot\startup-services.ps1")"
$taskName = "MasterHub Startup Services"

Write-Output "Registering scheduled task '$taskName' to run: $scriptPath"

# Build action
$action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
# Trigger: At startup
$trigger = New-ScheduledTaskTrigger -AtStartup
# Settings
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable
# Register
try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
    Write-Output "Scheduled task registered."
} catch {
    Write-Error "Failed to register scheduled task: $_"
    exit 1
}

Write-Output "If registration succeeded, the startup script will run at next system startup."
