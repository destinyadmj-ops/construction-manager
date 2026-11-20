<#
  MASTER HUB: install the work-table sender on the COMPANY PC (Windows PowerShell 5.1, ASCII only)

  - Copies shared-sync-agent.ps1 to %LOCALAPPDATA%\MasterHubAgent (stable place, independent of the repo).
  - Stores the upload token DPAPI-protected (only this Windows user on this PC can read it).
    The token is typed here (hidden prompt). Do not paste it into chats or commit it.
  - Registers a Scheduled Task for the CURRENT user: at logon + every 5 minutes. No admin rights needed.
  - -Uninstall removes the task (keeps the config folder unless -RemoveFiles is given).

  Example:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-shared-sync-agent.ps1 -ServerUrl https://example.invalid
#>
[CmdletBinding()]
param(
  [string]$ServerUrl,
  [string]$SourceDir,
  [int]$IntervalMinutes = 5,
  [switch]$Uninstall,
  [switch]$RemoveFiles,
  [switch]$SkipTestRun
)

$ErrorActionPreference = 'Stop'
$TaskName = 'MasterHub Shared Sync Agent'
$ConfigDir = Join-Path $env:LOCALAPPDATA 'MasterHubAgent'

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Task removed: $TaskName"
  } else {
    Write-Host "Task not found: $TaskName"
  }
  if ($RemoveFiles -and (Test-Path -LiteralPath $ConfigDir)) {
    Remove-Item -LiteralPath $ConfigDir -Recurse -Force
    Write-Host "Removed: $ConfigDir"
  }
  return
}

if (-not $ServerUrl) { $ServerUrl = Read-Host 'Server URL (https://...)' }
$ServerUrl = $ServerUrl.Trim().TrimEnd('/')
if (-not $ServerUrl.StartsWith('https://')) { throw 'ServerUrl must start with https:// (the token is sent in a header).' }
if ($IntervalMinutes -lt 1 -or $IntervalMinutes -gt 60) { throw 'IntervalMinutes must be 1..60' }

$agentSource = Join-Path $PSScriptRoot 'shared-sync-agent.ps1'
if (-not (Test-Path -LiteralPath $agentSource)) { throw "shared-sync-agent.ps1 not found next to this script: $agentSource" }

if (-not (Test-Path -LiteralPath $ConfigDir)) { New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null }
$agentPath = Join-Path $ConfigDir 'shared-sync-agent.ps1'
Copy-Item -LiteralPath $agentSource -Destination $agentPath -Force

# token: hidden prompt -> DPAPI (current user only)
$tokenPath = Join-Path $ConfigDir 'token.dat'
$replaceToken = $true
if (Test-Path -LiteralPath $tokenPath) {
  $answer = Read-Host 'A token is already stored. Replace it? (y/N)'
  $replaceToken = ($answer -eq 'y' -or $answer -eq 'Y')
}
if ($replaceToken) {
  $secure = Read-Host 'Upload token (input is hidden)' -AsSecureString
  if ($secure.Length -lt 32) { throw 'The token must be at least 32 characters.' }
  $secure | ConvertFrom-SecureString | Set-Content -LiteralPath $tokenPath -Encoding ASCII
  # restrict the file to the current user
  & icacls.exe $tokenPath /inheritance:r /grant:r ("{0}:F" -f $env:USERNAME) | Out-Null
}

$config = [ordered]@{ serverUrl = $ServerUrl }
if ($SourceDir) { $config.sourceDir = $SourceDir }
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $ConfigDir 'config.json'), ($config | ConvertTo-Json), $utf8)

# Scheduled Task: at logon + every N minutes (catches up after the PC was off: StartWhenAvailable)
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Once' -f $agentPath
$action = New-ScheduledTaskAction -Execute $psExe -Argument $arg
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $user),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650))
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal `
  -Description 'MASTER HUB: send the work table (read-only) to the server' -Force | Out-Null
Write-Host "Task registered: $TaskName (every $IntervalMinutes min, current user: $user)"
Write-Host "Files: $ConfigDir  (log: agent.log)"

if (-not $SkipTestRun) {
  Write-Host 'Test run...'
  & $psExe -NoProfile -ExecutionPolicy Bypass -File $agentPath -Once
  Write-Host ("Test run exit code: {0} (0 = OK, 1 = error, 2 = original file not readable/found; see agent.log)" -f $LASTEXITCODE)
}
