param(
  [string]$TaskName = "MasterHub Dev Server (dev:keep)"
)

$ErrorActionPreference = 'Stop'

Write-Host "Removing Scheduled Task..."
Write-Host "- TaskName: $TaskName"

if (Get-Command Unregister-ScheduledTask -ErrorAction SilentlyContinue) {
  $exists = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($null -ne $exists) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false | Out-Null
  }
  Write-Host "Done."
} else {
  throw "ScheduledTasks module is not available on this system."
}