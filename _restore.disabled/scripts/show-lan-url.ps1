param(
  [int]$Port = 3001,
  [string]$Path = '/?mode=week',
  [switch]$CopyFirst
)

$ErrorActionPreference = 'Stop'

function Get-Ipv4Candidates {
  try {
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -and
        $_.IPAddress -ne '127.0.0.1' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.ValidLifetime -ne ([TimeSpan]::Zero)
      } |
      Select-Object IPAddress, InterfaceAlias, PrefixOrigin, SuffixOrigin | Sort-Object InterfaceAlias, IPAddress

    if ($ips) { return $ips }
  } catch {
    # ignore
  }

  # Fallback (older PS / limited env)
  try {
    $out = ipconfig | Out-String
    $matches = [regex]::Matches($out, '(?<!\d)(\d{1,3}(?:\.\d{1,3}){3})(?!\d)')
    $ips = $matches | ForEach-Object {
      [pscustomobject]@{ IPAddress = $_.Groups[1].Value; InterfaceAlias = '' }
    } |
      Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } |
      Select-Object -Unique IPAddress, InterfaceAlias
    return $ips
  } catch {
    return @()
  }
}

function Get-IpScore([string]$ip, [string]$alias) {
  $score = 0
  if ($alias) {
    if ($alias -match 'Wi-?Fi|Wireless') { $score += 100 }
    if ($alias -match 'Ethernet') { $score += 90 }
    if ($alias -match 'vEthernet|WSL|Hyper-V|Virtual|VMware|VirtualBox') { $score -= 200 }
  }

  if ($ip -match '^192\.168\.') { $score += 80 }
  elseif ($ip -match '^10\.') { $score += 70 }
  elseif ($ip -match '^172\.(1[6-9]|2\d|3[0-1])\.') { $score += 60 }

  # deprioritize common WSL/host-only ranges if present
  if ($ip -match '^172\.(2[0-9]|3[0-1])\.') { $score -= 10 }

  return $score
}

$pathNorm = $Path
if (-not $pathNorm.StartsWith('/')) { $pathNorm = '/' + $pathNorm }

Write-Host ("[INFO] LAN URL candidates (port={0}, path={1})" -f $Port, $pathNorm)
$ips = Get-Ipv4Candidates

if (-not $ips -or $ips.Count -eq 0) {
  Write-Host "[WARN] IPv4 address not found. Check Wi-Fi/LAN connection."
  exit 0
}

$items = @()
foreach ($x in $ips) {
  $ip = $x.IPAddress
  if (-not $ip) { continue }
  $alias = ''
  try { $alias = [string]$x.InterfaceAlias } catch { $alias = '' }
  $score = Get-IpScore -ip $ip -alias $alias
  $items += [pscustomobject]@{ Url = ("http://{0}:{1}{2}" -f $ip, $Port, $pathNorm); IPAddress = $ip; InterfaceAlias = $alias; Score = $score }
}

$items = $items | Sort-Object -Property @{ Expression = 'Score'; Descending = $true }, @{ Expression = 'IPAddress'; Descending = $false }

foreach ($it in $items) {
  if ($it.InterfaceAlias) {
    Write-Host ("  {0}  ({1})" -f $it.Url, $it.InterfaceAlias)
  } else {
    Write-Host ("  {0}" -f $it.Url)
  }
}

if ($CopyFirst -and $items.Count -gt 0) {
  $best = $items[0].Url
  try {
    $best | Set-Clipboard
    Write-Host ("[INFO] Copied to clipboard: {0}" -f $best)
  } catch {
    Write-Host "[WARN] Failed to copy to clipboard."
  }
}
