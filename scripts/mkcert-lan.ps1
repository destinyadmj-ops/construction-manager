param(
  [int]$HttpPort = 3001,
  [int]$HttpsPort = 3443,
  [string]$Path = '/?mode=week'
)

$ErrorActionPreference = 'Stop'

function Get-BestLanIp {
  try {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -and
        $_.IPAddress -ne '127.0.0.1' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.ValidLifetime -ne ([TimeSpan]::Zero)
      } |
      Select-Object IPAddress, InterfaceAlias

    function Score([string]$ip, [string]$alias) {
      $s = 0
      if ($alias) {
        if ($alias -match 'Wi-?Fi|Wireless') { $s += 100 }
        if ($alias -match 'Ethernet') { $s += 90 }
        if ($alias -match 'vEthernet|WSL|Hyper-V|Virtual|VMware|VirtualBox') { $s -= 200 }
      }
      if ($ip -match '^192\.168\.') { $s += 80 }
      elseif ($ip -match '^10\.') { $s += 70 }
      elseif ($ip -match '^172\.(1[6-9]|2\d|3[0-1])\.') { $s += 60 }
      if ($ip -match '^172\.(2[0-9]|3[0-1])\.') { $s -= 10 }
      return $s
    }

    $best = $null
    $bestScore = -9999
    foreach ($c in $candidates) {
      $ip = [string]$c.IPAddress
      $alias = [string]$c.InterfaceAlias
      $sc = Score $ip $alias
      if ($sc -gt $bestScore) {
        $bestScore = $sc
        $best = $c
      }
    }

    if ($best -and $best.IPAddress) { return [string]$best.IPAddress }
  } catch {
    # ignore
  }

  return $null
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$ip = Get-BestLanIp
if (-not $ip) {
  Write-Host '[ERR] LAN IPv4 address not found. Connect to Wi-Fi/Ethernet first.'
  exit 1
}

$mkcert = Get-Command mkcert -ErrorAction SilentlyContinue
if (-not $mkcert) {
  Write-Host '[ERR] mkcert not found. Install mkcert first.'
  Write-Host '  - Windows: winget install FiloSottile.mkcert'
  Write-Host '  - Or: https://github.com/FiloSottile/mkcert'
  exit 1
}

$certDir = Join-Path $repoRoot '.cert\lan'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null
    
    $ipFile = Join-Path $certDir 'current-ip.txt'
    $ip | Set-Content -Path $ipFile -Encoding ascii

$certFile = Join-Path $certDir ("lan-{0}.pem" -f $ip)
$keyFile = Join-Path $certDir ("lan-{0}-key.pem" -f $ip)

Write-Host ("[INFO] mkcert -install (PC trust store)")
& mkcert -install | Out-Null

Write-Host ("[INFO] generating cert for IP: {0}" -f $ip)
& mkcert -cert-file $certFile -key-file $keyFile $ip
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ("[INFO] cert: {0}" -f $certFile)
Write-Host ("[INFO] key : {0}" -f $keyFile)
  Write-Host ("[INFO] ip  : {0} (saved to {1})" -f $ip, $ipFile)

$pathNorm = $Path
if (-not $pathNorm.StartsWith('/')) { $pathNorm = '/' + $pathNorm }
Write-Host ("[INFO] HTTPS URL: https://{0}:{1}{2}" -f $ip, $HttpsPort, $pathNorm)

try {
  ("https://{0}:{1}{2}" -f $ip, $HttpsPort, $pathNorm) | Set-Clipboard
  Write-Host '[INFO] Copied HTTPS URL to clipboard.'
} catch {
  # ignore
}

Write-Host ''
Write-Host '[NEXT] Android trust setup (required once per phone):'
Write-Host '  1) Run: mkcert -CAROOT  (to locate rootCA.pem)'
Write-Host '  2) Copy rootCA.pem to the phone (rename to rootCA.crt if needed)'
Write-Host '  3) Android Settings -> Security -> Encryption & credentials -> Install a certificate -> CA certificate'
Write-Host '  4) Reopen Chrome and access the HTTPS URL'
