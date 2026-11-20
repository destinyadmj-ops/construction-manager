<#
  MASTER HUB: work-table (original) sender  -- runs on the COMPANY PC (Windows PowerShell 5.1)

  - Reads the original Excel file on the shared folder READ-ONLY (never writes / renames / deletes it).
  - Asks the server whether it already has the same content (SHA-256). Sends the file only when it changed.
  - Every run also acts as a heartbeat, so the app can warn when this PC stops talking.
  - Token: DPAPI-protected file (per Windows user) or env SHARED_SYNC_UPLOAD_TOKEN. Never printed or logged.
  - This file is ASCII only on purpose (Windows PowerShell 5.1 reads BOM-less files as ANSI).

  Install / schedule:  scripts\install-shared-sync-agent.ps1
  Manual run:          powershell -NoProfile -ExecutionPolicy Bypass -File shared-sync-agent.ps1 -Once
#>
[CmdletBinding()]
param(
  [string]$ServerUrl,
  [string]$SourceDir,
  [string]$ConfigDir,
  [int]$Retries = 3,
  [switch]$Once,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

function J([int[]]$codes) { -join ($codes | ForEach-Object { [char]$_ }) }
# work table file name prefix: U+4F5C U+696D U+8868 U+2606
$WorkTablePrefix = J @(0x4F5C, 0x696D, 0x8868, 0x2606)
# default shared folder: \\192.168.0.210\guest\ + (U+5171 U+6709 U+30D5 U+30A9 U+30EB U+30C0)
$DefaultSourceDir = '\\192.168.0.210\guest\' + (J @(0x5171, 0x6709, 0x30D5, 0x30A9, 0x30EB, 0x30C0))
$MaxBytes = 25MB

if (-not $ConfigDir) { $ConfigDir = Join-Path $env:LOCALAPPDATA 'MasterHubAgent' }
if (-not (Test-Path -LiteralPath $ConfigDir)) { New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null }
$LogPath = Join-Path $ConfigDir 'agent.log'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Log([string]$message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  try {
    if ((Test-Path -LiteralPath $LogPath) -and ((Get-Item -LiteralPath $LogPath).Length -gt 1MB)) {
      Move-Item -LiteralPath $LogPath -Destination ($LogPath + '.old') -Force
    }
    [IO.File]::AppendAllText($LogPath, $line + [Environment]::NewLine, $utf8)
  } catch { }
  Write-Host $line
}

function Read-Config {
  $path = Join-Path $ConfigDir 'config.json'
  if (Test-Path -LiteralPath $path) {
    try { return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json) } catch { Write-Log 'config.json could not be read (ignored)' }
  }
  return $null
}

function Read-Token {
  if ($env:SHARED_SYNC_UPLOAD_TOKEN) { return $env:SHARED_SYNC_UPLOAD_TOKEN.Trim() }
  $path = Join-Path $ConfigDir 'token.dat'
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $secure = (Get-Content -LiteralPath $path -Raw).Trim() | ConvertTo-SecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Get-HttpStatus($err) {
  try { if ($err.Exception.Response) { return [int]$err.Exception.Response.StatusCode } } catch { }
  return 0
}

function Invoke-Api([string]$method, [string]$url, [hashtable]$headers, [byte[]]$body) {
  $params = @{ Uri = $url; Method = $method; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 120 }
  if ($body) { $params.Body = $body; $params.ContentType = 'application/octet-stream' }
  $res = Invoke-WebRequest @params
  return ($res.Content | ConvertFrom-Json)
}

# retry on network errors / 5xx / 429 only. Auth and validation errors (4xx) are not retried.
function Invoke-WithRetry([scriptblock]$action, [string]$what) {
  $delays = @(5, 20, 60)
  for ($attempt = 1; ; $attempt++) {
    try { return (& $action) } catch {
      $status = Get-HttpStatus $_
      $retryable = ($status -eq 0) -or ($status -ge 500) -or ($status -eq 429)
      if (-not $retryable -or $attempt -ge $Retries) {
        Write-Log ("{0} failed (http={1}): {2}" -f $what, $status, $_.Exception.Message)
        throw
      }
      $wait = $delays[[Math]::Min($attempt - 1, $delays.Count - 1)]
      Write-Log ("{0} failed (http={1}), retry in {2}s ({3}/{4})" -f $what, $status, $wait, $attempt, $Retries)
      Start-Sleep -Seconds $wait
    }
  }
}

function Find-WorkTable([string]$dir) {
  $items = Get-ChildItem -LiteralPath $dir -File -ErrorAction Stop | Where-Object {
    $_.Name -notlike '~$*' -and -not $_.Name.StartsWith('.') -and
    $_.Name.StartsWith($WorkTablePrefix) -and ($_.Extension -eq '.xlsx' -or $_.Extension -eq '.xls')
  }
  return ($items | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1)
}

# Open read-only and let other programs keep editing the file (FileShare.ReadWrite|Delete). Read into memory.
function Read-FileBytes([string]$path) {
  $fs = New-Object System.IO.FileStream($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  try {
    if ($fs.Length -gt $MaxBytes) { throw ('file too large: {0} bytes' -f $fs.Length) }
    $buf = New-Object byte[] ([int]$fs.Length)
    $read = 0
    while ($read -lt $buf.Length) {
      $n = $fs.Read($buf, $read, $buf.Length - $read)
      if ($n -le 0) { break }
      $read += $n
    }
    if ($read -ne $buf.Length) { throw 'short read' }
    return ,$buf
  } finally { $fs.Dispose() }
}

function Get-Sha256Hex([byte[]]$bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $sha.Dispose() }
}

function Invoke-Once {
  $cfg = Read-Config
  if (-not $ServerUrl) { $ServerUrl = if ($env:SHARED_SYNC_SERVER_URL) { $env:SHARED_SYNC_SERVER_URL } elseif ($cfg) { [string]$cfg.serverUrl } }
  if (-not $SourceDir) { $SourceDir = if ($env:SHARED_SYNC_SOURCE_DIR) { $env:SHARED_SYNC_SOURCE_DIR } elseif ($cfg -and $cfg.sourceDir) { [string]$cfg.sourceDir } else { $DefaultSourceDir } }
  if (-not $ServerUrl) { throw 'ServerUrl is not set (run install-shared-sync-agent.ps1 or pass -ServerUrl)' }
  $endpoint = $ServerUrl.TrimEnd('/') + '/api/sites/shared-sync/upload'
  if (-not $endpoint.StartsWith('https://') -and -not $endpoint.StartsWith('http://localhost') -and -not $endpoint.StartsWith('http://127.0.0.1')) {
    throw 'ServerUrl must be https:// (the token is sent in a header)'
  }
  $token = Read-Token
  if (-not $token) { throw 'token is not set (run install-shared-sync-agent.ps1 or set SHARED_SYNC_UPLOAD_TOKEN)' }
  $headers = @{ Authorization = ('Bearer ' + $token); 'x-agent-host' = $env:COMPUTERNAME }

  # heartbeat first: also tells us which content the server already has
  $remote = Invoke-WithRetry { Invoke-Api 'GET' $endpoint $headers $null } 'heartbeat'

  $file = $null
  try { $file = Find-WorkTable $SourceDir } catch {
    Write-Log ('shared folder is not readable: {0} ({1})' -f $SourceDir, $_.Exception.Message)
    return 2
  }
  if (-not $file) { Write-Log ('no work-table file found in {0}' -f $SourceDir); return 2 }

  $bytes = Read-FileBytes $file.FullName
  $sha = Get-Sha256Hex $bytes
  if ($remote.sha256 -eq $sha) { Write-Log ('unchanged: {0} ({1} bytes)' -f $file.Name, $bytes.Length); return 0 }
  if ($DryRun) { Write-Log ('dry-run: would send {0} ({1} bytes)' -f $file.Name, $bytes.Length); return 0 }

  $mtimeMs = [long]([DateTimeOffset]$file.LastWriteTimeUtc).ToUnixTimeMilliseconds()
  $postHeaders = @{
    Authorization = ('Bearer ' + $token)
    'x-agent-host' = $env:COMPUTERNAME
    'x-file-name' = [Uri]::EscapeDataString($file.Name)
    'x-source-mtime' = [string]$mtimeMs
    'x-sha256' = $sha
  }
  $res = Invoke-WithRetry { Invoke-Api 'POST' $endpoint $postHeaders $bytes } 'upload'
  Write-Log ('sent: {0} ({1} bytes) changed={2}' -f $file.Name, $bytes.Length, $res.changed)
  return 0
}

# only one run at a time (the scheduled task may overlap with a manual run)
$mutex = New-Object System.Threading.Mutex($false, 'Local\MasterHubSharedSyncAgent')
if (-not $mutex.WaitOne(0)) { Write-Log 'another run is in progress, skipped'; exit 0 }
try {
  $code = Invoke-Once
  exit $code
} catch {
  Write-Log ('error: ' + $_.Exception.Message)
  exit 1
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
