param(
  [int]$Port = 3000,
  [string]$Path = "/"
)

$ErrorActionPreference = 'Stop'

if (-not $PSBoundParameters.ContainsKey('Port')) {
  $envPort = $env:PORT
  if ($envPort -and ($envPort -as [int])) {
    $Port = [int]$envPort
  }
}

if ([string]::IsNullOrWhiteSpace($Path)) {
  $Path = "/"
}
if (-not $Path.StartsWith('/')) {
  $Path = "/$Path"
}

$url = "http://localhost:$Port$Path"
Write-Host "Opening: $url"
Start-Process $url
