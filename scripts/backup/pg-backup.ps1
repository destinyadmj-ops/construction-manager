Param(
  [Parameter(Mandatory = $false)]
  [string]$DatabaseUrl,

  # Optional env file to load (e.g. .env.production). If not provided, tries .env.production, then .env.local, then .env under repo root.
  [Parameter(Mandatory = $false)]
  [string]$EnvFile,

  # Connection timeout for pg_dump (seconds). Prevents hanging when DB is unreachable.
  [Parameter(Mandatory = $false)]
  [int]$ConnectTimeoutSeconds = 10,

  # Output directory. Recommended: a SharePoint library folder synced by OneDrive.
  [Parameter(Mandatory = $true)]
  [string]$OutDir,

  # Keep last N hourly backups (files named backup_YYYYMMDD_HH.sql.gz)
  [Parameter(Mandatory = $false)]
  [int]$KeepHours = 48,

  # Additionally keep daily snapshots (one per day) for N days
  [Parameter(Mandatory = $false)]
  [int]$KeepDays = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Get-NowStamp() {
  $now = Get-Date
  $yyyymmdd = $now.ToString('yyyyMMdd')
  $hh = $now.ToString('HH')
  return @{ Date = $now; HourStamp = "$yyyymmdd`_$hh"; DayStamp = $now.ToString('yyyyMMdd') }
}

function Invoke-PgDump([string]$DatabaseUrl, [string]$OutSqlPath, [int]$ConnectTimeoutSeconds) {
  $pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($pgDump) {
    $prevTimeout = $env:PGCONNECT_TIMEOUT
    try {
      if ($ConnectTimeoutSeconds -gt 0) {
        $env:PGCONNECT_TIMEOUT = "$ConnectTimeoutSeconds"
      }
      & $pgDump.Source "$DatabaseUrl" --no-owner --no-privileges --format=p --file "$OutSqlPath"
      return $LASTEXITCODE
    } finally {
      $env:PGCONNECT_TIMEOUT = $prevTimeout
    }
  }

  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    throw 'pg_dump not found and docker not found. Install PostgreSQL client tools (pg_dump) or Docker.'
  }

  # Fallback: run pg_dump inside a postgres image.
  # Requires Docker to be able to bind-mount the output directory.
  $outDir = Split-Path -Parent $OutSqlPath
  $outFile = Split-Path -Leaf $OutSqlPath
  $mountSpec = "type=bind,source=$outDir,target=/out"
  & $docker.Source run --rm --pull=missing --mount $mountSpec -e "PGCONNECT_TIMEOUT=$ConnectTimeoutSeconds" postgres:16 pg_dump "$DatabaseUrl" --no-owner --no-privileges --format=p --file "/out/$outFile"
  return $LASTEXITCODE
}

function Gzip-File([string]$InPath, [string]$OutPath) {
  $inStream = [System.IO.File]::OpenRead($InPath)
  try {
    $outStream = [System.IO.File]::Create($OutPath)
    try {
      $gzip = New-Object System.IO.Compression.GZipStream($outStream, [System.IO.Compression.CompressionLevel]::Optimal)
      try {
        $inStream.CopyTo($gzip)
      } finally {
        $gzip.Dispose()
      }
    } finally {
      $outStream.Dispose()
    }
  } finally {
    $inStream.Dispose()
  }
}

function Resolve-DatabaseUrl([string]$ArgUrl) {
  if (-not [string]::IsNullOrWhiteSpace($ArgUrl)) { return $ArgUrl }
  if (-not [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) { return $env:DATABASE_URL }
  throw 'DATABASE_URL is required. Pass -DatabaseUrl, set env:DATABASE_URL, or provide -EnvFile (e.g. .env.production/.env.local).'
}

function Normalize-DatabaseUrlForPgDump([string]$Url) {
  if ([string]::IsNullOrWhiteSpace($Url)) { return $Url }

  $qIndex = $Url.IndexOf('?')
  if ($qIndex -lt 0) { return $Url }

  $base = $Url.Substring(0, $qIndex)
  $query = $Url.Substring($qIndex + 1)
  if ([string]::IsNullOrWhiteSpace($query)) { return $base }

  $parts = $query.Split('&') | Where-Object { $_ -and $_.Trim().Length -gt 0 }
  $kept = @()
  foreach ($p in $parts) {
    if ($p -match '^(?i)schema=') { continue }
    $kept += $p
  }

  if ($kept.Count -eq 0) { return $base }
  return ($base + '?' + ($kept -join '&'))
}

function Import-EnvFileIfNeeded() {
  if (-not [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) { return }

  $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($EnvFile)) {
    $candidates += $EnvFile
  } else {
    $candidates += (Join-Path $repoRoot '.env.production')
    $candidates += (Join-Path $repoRoot '.env.local')
    $candidates += (Join-Path $repoRoot '.env')
  }

  foreach ($p in $candidates) {
    if (-not $p) { continue }
    $path = $p
    if (-not [System.IO.Path]::IsPathRooted($path)) {
      $path = Join-Path $repoRoot $path
    }
    if (-not (Test-Path -LiteralPath $path)) { continue }

    try {
      $lines = Get-Content -LiteralPath $path -ErrorAction Stop
    } catch {
      continue
    }

    foreach ($line in $lines) {
      $t = $line.Trim()
      if (-not $t) { continue }
      if ($t.StartsWith('#')) { continue }
      if ($t -notmatch '^[A-Za-z_][A-Za-z0-9_]*=') { continue }

      $eq = $t.IndexOf('=')
      if ($eq -lt 1) { continue }
      $key = $t.Substring(0, $eq).Trim()
      $val = $t.Substring($eq + 1).Trim()
      if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
        $val = $val.Substring(1, $val.Length - 2)
      }

      if ($key -eq 'DATABASE_URL' -and -not [string]::IsNullOrWhiteSpace($val)) {
        $env:DATABASE_URL = $val
        return
      }
    }
  }
}

function Prune-Backups([string]$Dir, [int]$KeepHours, [int]$KeepDays) {
  $files = Get-ChildItem -LiteralPath $Dir -File -Filter 'backup_*.sql.gz' | Sort-Object LastWriteTime -Descending

  # Keep last N hourly backups
  $hourlyKeep = @{}
  for ($i = 0; $i -lt [Math]::Min($KeepHours, $files.Count); $i++) {
    $hourlyKeep[$files[$i].FullName] = $true
  }

  # Keep one per day for N days (prefer latest within the day)
  $dailyGroups = @{}
  foreach ($f in $files) {
    if ($f.Name -match '^backup_(\d{8})_\d{2}\.sql\.gz$') {
      $day = $Matches[1]
      if (-not $dailyGroups.ContainsKey($day)) {
        $dailyGroups[$day] = $f
      }
    }
  }

  $days = $dailyGroups.Keys | Sort-Object -Descending
  for ($i = 0; $i -lt [Math]::Min($KeepDays, $days.Count); $i++) {
    $f = $dailyGroups[$days[$i]]
    $hourlyKeep[$f.FullName] = $true
  }

  $removed = 0
  foreach ($f in $files) {
    if ($hourlyKeep.ContainsKey($f.FullName)) { continue }
    Remove-Item -LiteralPath $f.FullName -Force
    $removed++
  }

  return $removed
}

try {
  Ensure-Directory $OutDir

  Import-EnvFileIfNeeded
  $url = Resolve-DatabaseUrl $DatabaseUrl
  $url = Normalize-DatabaseUrlForPgDump $url
  $stamp = Get-NowStamp

  $tmpSql = Join-Path $OutDir ("backup_$($stamp.HourStamp).sql")
  $outGz = Join-Path $OutDir ("backup_$($stamp.HourStamp).sql.gz")

  Write-Host "Running pg_dump to: $tmpSql" -ForegroundColor Cyan

  # Use custom format? For easiest restore with psql, keep plain SQL.
  # --no-owner/--no-privileges helps portability.
  $exitCode = Invoke-PgDump -DatabaseUrl $url -OutSqlPath $tmpSql -ConnectTimeoutSeconds $ConnectTimeoutSeconds
  if ($exitCode -ne 0) {
    throw "pg_dump failed with exit code $exitCode"
  }

  Write-Host "Compressing to: $outGz" -ForegroundColor Cyan
  Gzip-File -InPath $tmpSql -OutPath $outGz
  Remove-Item -LiteralPath $tmpSql -Force

  $removed = Prune-Backups -Dir $OutDir -KeepHours $KeepHours -KeepDays $KeepDays

  Write-Host "OK: $outGz" -ForegroundColor Green
  Write-Host "Pruned: $removed" -ForegroundColor DarkGray
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
