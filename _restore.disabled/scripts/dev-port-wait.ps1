param(
  [int]$Port = 3000,
  [int]$TimeoutSec = 15,
  [int]$PollMs = 250
)

$ErrorActionPreference = 'Stop'

if (-not $PSBoundParameters.ContainsKey('Port')) {
  $envPort = $env:PORT
  if ($envPort -and ($envPort -as [int])) {
    $Port = [int]$envPort
  }
}

Write-Host "Waiting for TCP localhost:$Port (timeout=${TimeoutSec}s)"
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  $tcp = Test-NetConnection localhost -Port $Port
  if ($tcp.TcpTestSucceeded) {
    Write-Host "TCP OK"
    exit 0
  }
  Start-Sleep -Milliseconds $PollMs
}

Write-Host "Timeout."
exit 1
