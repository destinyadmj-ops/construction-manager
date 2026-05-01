param(
  [string]$TaskName = "MasterHub Dev Server (dev:keep)",
  [string]$MonitorTaskName = "MasterHub Dev Server Monitor (dev:keep)",
  [ValidateRange(1, 60)]
  [int]$MonitorIntervalMinutes = 5,
  [int]$DelaySeconds = 10
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$cmdPath = Join-Path $repoRoot 'run-dev-keep-agent.cmd'

if (-not (Test-Path $cmdPath)) {
  throw "run-dev-keep-agent.cmd not found: $cmdPath"
}

Write-Host "Installing Scheduled Task..."
Write-Host "- LogonTask : $TaskName"
Write-Host "- MonitorTask: $MonitorTaskName"
Write-Host "- Execute   : $cmdPath"
Write-Host "- Delay     : ${DelaySeconds}s (after logon)"
Write-Host "- Monitor   : every $MonitorIntervalMinutes minute(s)"

function New-TaskAction {
  param(
    [int]$StartDelaySeconds = 0
  )

  if ($StartDelaySeconds -gt 0) {
    $cmdEscaped = $cmdPath.Replace("'", "''")
    $psCommand = "Start-Sleep -Seconds $StartDelaySeconds; & '$cmdEscaped'"
    $psArgs = "-NoProfile -ExecutionPolicy Bypass -Command `"$psCommand`""
    return New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psArgs
  }

  return New-ScheduledTaskAction -Execute $cmdPath
}

function New-MonitorTaskTrigger {
  return New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes $MonitorIntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
}

function Install-WithScheduledTasksModule {
  $logonAction = New-TaskAction -StartDelaySeconds $DelaySeconds
  $logonTrigger = New-ScheduledTaskTrigger -AtLogOn
  $monitorAction = New-TaskAction
  $monitorTrigger = New-MonitorTaskTrigger
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

  Register-ScheduledTask -TaskName $TaskName -Action $logonAction -Trigger $logonTrigger -Principal $principal -Settings $settings -Force | Out-Null
  Register-ScheduledTask -TaskName $MonitorTaskName -Action $monitorAction -Trigger $monitorTrigger -Principal $principal -Settings $settings -Force | Out-Null
}

function Install-WithSchtasks {
  $taskCommand = "cmd.exe /c `"`"$cmdPath`"`""

  $logonArgs = @(
    '/Create'
    '/F'
    '/SC', 'ONLOGON'
    '/TN', $TaskName
    '/TR', $taskCommand
  )

  if ($DelaySeconds -gt 0) {
    $delay = '0000:' + ([string]$DelaySeconds).PadLeft(2, '0')
    $logonArgs += @('/DELAY', $delay)
  }

  & schtasks.exe @logonArgs | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks.exe failed to create logon task with exit code $LASTEXITCODE"
  }

  $monitorArgs = @(
    '/Create'
    '/F'
    '/SC', 'MINUTE'
    '/MO', "$MonitorIntervalMinutes"
    '/TN', $MonitorTaskName
    '/TR', $taskCommand
  )

  & schtasks.exe @monitorArgs | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks.exe failed to create monitor task with exit code $LASTEXITCODE"
  }
}

function Install-WithStartupShortcut {
  $startupInstaller = Join-Path $PSScriptRoot 'install-dev-startup.ps1'
  if (-not (Test-Path $startupInstaller)) {
    throw "install-dev-startup.ps1 not found: $startupInstaller"
  }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startupInstaller
  if ($LASTEXITCODE -ne 0) {
    throw "Startup shortcut install failed with exit code $LASTEXITCODE"
  }
}

if (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue) {
  try {
    Install-WithScheduledTasksModule
  } catch {
    Write-Warning "Register-ScheduledTask failed. Falling back to schtasks.exe. $_"
    try {
      Install-WithSchtasks
    } catch {
      Write-Warning "schtasks.exe also failed. Falling back to Startup shortcut. $_"
      Install-WithStartupShortcut
    }
  }
} else {
  try {
    Install-WithSchtasks
  } catch {
    Write-Warning "schtasks.exe failed. Falling back to Startup shortcut. $_"
    Install-WithStartupShortcut
  }
}

Write-Host "Done. It will auto-start at next logon."
Write-Host "Done. It will also self-heal every $MonitorIntervalMinutes minute(s) while the PC is logged in."
Write-Host "To remove: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall-dev-autostart.ps1"