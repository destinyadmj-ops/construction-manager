# Wrapper to load DATABASE_URL from user file and run pg-backup.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$envFile = "$env:USERPROFILE\.supabase_database_url"
if (-not (Test-Path -LiteralPath $envFile)) {
  Write-Error "Supabase DB URL file not found: $envFile"
  exit 1
}

$val = Get-Content -Raw -Encoding UTF8 $envFile
$env:DATABASE_URL = $val

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$outDir = Join-Path $scriptDir 'out'

Write-Host "Using OutDir: $outDir"
& (Join-Path $scriptDir 'pg-backup.ps1') -OutDir $outDir -KeepHours 48 -KeepDays 7
