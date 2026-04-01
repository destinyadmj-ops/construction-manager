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

function New-StartupTaskAction {
  if ($DelaySeconds -gt 0) {
    $cmdEscaped = $cmdPath.Replace("'", "''")
    $psCommand = "Start-Sleep -Seconds $DelaySeconds; & '$cmdEscaped'"
    $psArgs = "-NoProfile -ExecutionPolicy Bypass -Command `"$psCommand`""
    return New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psArgs
  }

  return New-ScheduledTaskAction -Execute $cmdPath
}

function Install-WithScheduledTasksModule {
  $action = New-StartupTaskAction
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}

function Install-WithSchtasks {
  $taskCommand = "cmd.exe /c `"`"$cmdPath`"`""

  $createArgs = @(
    '/Create'
    '/F'
    '/SC', 'ONLOGON'
    '/TN', $TaskName
    '/TR', $taskCommand
  )

  if ($DelaySeconds -gt 0) {
    $delay = '0000:' + ([string]$DelaySeconds).PadLeft(2, '0')
    $createArgs += @('/DELAY', $delay)
  }

  & schtasks.exe @createArgs | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks.exe failed with exit code $LASTEXITCODE"
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
Write-Host "To remove: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall-dev-autostart.ps1"