param(
  [string]$TaskName = "MasterHub Dev Server (dev:keep)",
  [int]$DelaySeconds = 10
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$cmdPath = Join-Path $repoRoot 'run-dev-keep.cmd'

if (-not (Test-Path $cmdPath)) {
  throw "run-dev-keep.cmd not found: $cmdPath"
}

Write-Host "Installing Scheduled Task..."
Write-Host "- TaskName: $TaskName"
Write-Host "- Execute : $cmdPath"
Write-Host "- Delay   : ${DelaySeconds}s (after logon)"

if (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue) {
  if ($DelaySeconds -gt 0) {
    $cmdEscaped = $cmdPath.Replace("'", "''")
    $psCommand = "Start-Sleep -Seconds $DelaySeconds; & '$cmdEscaped'"
    $psArgs = "-NoProfile -ExecutionPolicy Bypass -Command `"$psCommand`""
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psArgs
  } else {
    $action = New-ScheduledTaskAction -Execute $cmdPath
  }
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
} else {
  throw "ScheduledTasks module is not available on this system."
}

Write-Host "Done. It will auto-start at next logon."
Write-Host "To remove: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall-dev-autostart.ps1"