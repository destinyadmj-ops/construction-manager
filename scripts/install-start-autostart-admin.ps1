param(
  [string]$TaskName = "MasterHub Production Server (start:keep)",
  [int]$DelaySeconds = 10
)

$ErrorActionPreference = 'Stop'

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$scriptPath = Join-Path $PSScriptRoot 'install-start-autostart.ps1'

if (-not (Test-Path $scriptPath)) {
  throw "install-start-autostart.ps1 not found: $scriptPath"
}

if (Test-IsAdministrator) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -TaskName $TaskName -DelaySeconds $DelaySeconds
  exit $LASTEXITCODE
}

$taskNameEscaped = $TaskName.Replace("'", "''")
$arguments = @(
  '-NoProfile'
  '-ExecutionPolicy', 'Bypass'
  '-File', ('"' + $scriptPath + '"')
  '-TaskName', ('"' + $taskNameEscaped + '"')
  '-DelaySeconds', $DelaySeconds
)

Write-Host 'Requesting administrator privileges for scheduled-task installation...'
$process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -Wait -PassThru
exit $process.ExitCode