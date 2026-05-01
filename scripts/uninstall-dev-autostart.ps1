param(
  [string]$TaskName = "MasterHub Dev Server (dev:keep)",
  [string]$MonitorTaskName = "MasterHub Dev Server Monitor (dev:keep)"
)

$ErrorActionPreference = 'Stop'

Write-Host "Removing Scheduled Task..."
Write-Host "- LogonTask : $TaskName"
Write-Host "- MonitorTask: $MonitorTaskName"

function Remove-TaskIfExists {
  param([string]$Name)

  if (Get-Command Unregister-ScheduledTask -ErrorAction SilentlyContinue) {
    $exists = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($null -ne $exists) {
      Unregister-ScheduledTask -TaskName $Name -Confirm:$false | Out-Null
      Write-Host "Removed task: $Name"
    }
    return
  }

  & schtasks.exe /Delete /TN $Name /F | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Removed task: $Name"
  }
}

Remove-TaskIfExists -Name $TaskName
Remove-TaskIfExists -Name $MonitorTaskName

$startupUninstaller = Join-Path $PSScriptRoot 'uninstall-dev-startup.ps1'
if (Test-Path $startupUninstaller) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startupUninstaller | Out-Null
}

Write-Host "Done."