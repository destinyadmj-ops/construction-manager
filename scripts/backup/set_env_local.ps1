Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$urlFile = "$env:USERPROFILE\.supabase_database_url"
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$envLocal = Join-Path $repoRoot '.env.local'

$url = (Get-Content -Raw -Encoding UTF8 $urlFile).Trim()
$newLine = "DATABASE_URL=`"$url`""

if (Test-Path -LiteralPath $envLocal) {
  $existing = Get-Content -Raw -Encoding UTF8 $envLocal
  if ($existing -match 'DATABASE_URL=') {
    $updated = ($existing -split "`n" | ForEach-Object {
      if ($_ -match '^DATABASE_URL=') { $newLine } else { $_ }
    }) -join "`n"
    Set-Content -Path $envLocal -Value $updated.TrimEnd() -Encoding UTF8 -NoNewline
    Write-Host "Updated existing DATABASE_URL in .env.local" -ForegroundColor Green
  } else {
    Add-Content -Path $envLocal -Value "`n$newLine" -Encoding UTF8
    Write-Host "Appended DATABASE_URL to .env.local" -ForegroundColor Green
  }
} else {
  Set-Content -Path $envLocal -Value $newLine -Encoding UTF8 -NoNewline
  Write-Host "Created .env.local with DATABASE_URL" -ForegroundColor Green
}

Write-Host "File: $envLocal" -ForegroundColor Cyan
