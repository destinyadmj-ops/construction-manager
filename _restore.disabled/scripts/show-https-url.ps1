param(
  [int]$HttpsPort = 3443,
  [string]$Path = '/?mode=week',
  [switch]$CopyFirst
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$certDir = Join-Path $repoRoot '.cert\lan'
$ipFile = Join-Path $certDir 'current-ip.txt'

if (-not (Test-Path $ipFile)) {
  Write-Host '[ERR] .cert/lan/current-ip.txt not found.'
  Write-Host 'Run mkcert first:'
  Write-Host '  npm run mkcert:lan'
  exit 1
}

$ip = (Get-Content $ipFile -Raw).Trim()
if (-not $ip) {
  Write-Host '[ERR] current-ip.txt is empty.'
  exit 1
}

$pathNorm = $Path
if (-not $pathNorm.StartsWith('/')) { $pathNorm = '/' + $pathNorm }

$url = "https://{0}:{1}{2}" -f $ip, $HttpsPort, $pathNorm
Write-Host $url

if ($CopyFirst) {
  try {
    $url | Set-Clipboard
    Write-Host '[INFO] Copied to clipboard.'
  } catch {
    Write-Host '[WARN] Clipboard copy failed.'
  }
}
