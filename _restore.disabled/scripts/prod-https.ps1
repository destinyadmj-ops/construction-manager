param(
  [int]$HttpPort = 3001,
  [int]$HttpsPort = 3443,
  [string]$Path = '/?mode=week',
  [switch]$Open
)

$ErrorActionPreference = 'Stop'

function Test-Health([string]$url) {
  try {
    $res = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri ("{0}/api/health" -f $url)
    return ($res.StatusCode -eq 200)
  } catch {
    return $false
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '[INFO] build (prod)'
& npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '[INFO] mkcert for LAN (generates .cert/lan/*.pem and copies https URL)'
& (Join-Path $PSScriptRoot 'mkcert-lan.ps1') -HttpPort $HttpPort -HttpsPort $HttpsPort -Path $Path
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Use the exact IP used for cert generation
$ipFile = Join-Path $repoRoot '.cert\\lan\\current-ip.txt'
$ip = $null
if (Test-Path $ipFile) {
  try { $ip = (Get-Content $ipFile -Raw).Trim() } catch { $ip = $null }
}
if (-not $ip) {
  Write-Host '[WARN] current-ip.txt missing; falling back to 127.0.0.1'
  $ip = '127.0.0.1'
}

$pathNorm = $Path
if (-not $pathNorm.StartsWith('/')) { $pathNorm = '/' + $pathNorm }
$httpsUrl = ("https://{0}:{1}{2}" -f $ip, $HttpsPort, $pathNorm)
if ($Open) {
  Write-Host ("[INFO] opening: {0}" -f $httpsUrl)
  try { Start-Process $httpsUrl | Out-Null } catch { Write-Host '[WARN] browser open failed.' }
}

$certFile = Join-Path $repoRoot (".cert\\lan\\lan-{0}.pem" -f $ip)
$keyFile = Join-Path $repoRoot (".cert\\lan\\lan-{0}-key.pem" -f $ip)

if (-not (Test-Path $certFile) -or -not (Test-Path $keyFile)) {
  Write-Host "[ERR] cert/key not found for IP=$ip"
  Write-Host "  cert: $certFile"
  Write-Host "  key : $keyFile"
  exit 1
}

Write-Host ("[INFO] start next (local): http://127.0.0.1:{0}" -f $HttpPort)
$next = Start-Process -FilePath "npx" -ArgumentList @('next','start','-H','127.0.0.1','-p',"$HttpPort") -NoNewWindow -PassThru

try {
  $httpBase = ("http://127.0.0.1:{0}" -f $HttpPort)
  Write-Host ("[INFO] waiting for health: {0}/api/health" -f $httpBase)

  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    if ($next.HasExited) {
      Write-Host ("[ERR] next start exited early with code={0}" -f $next.ExitCode)
      exit $next.ExitCode
    }
    if (Test-Health $httpBase) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }

  if (-not $ready) {
    Write-Host '[ERR] next start did not become healthy in time.'
    exit 1
  }

  $env:TLS_CERT = $certFile
  $env:TLS_KEY = $keyFile
  $env:TARGET_URL = $httpBase
  $env:HTTPS_PORT = "$HttpsPort"

  Write-Host ("[INFO] start HTTPS proxy: https://0.0.0.0:{0}" -f $HttpsPort)
  & node (Join-Path $PSScriptRoot 'https-proxy.mjs')
  exit $LASTEXITCODE
} finally {
  if ($next -and -not $next.HasExited) {
    try { Stop-Process -Id $next.Id -Force } catch {}
  }
}
