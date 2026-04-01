Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$path = "$env:USERPROFILE\.supabase_database_url"
$raw = Get-Content -Raw -Encoding UTF8 $path

# 改行・余分なスペースを除去して1行に
$cleaned = ($raw -split '\s+' | Where-Object { $_ -ne '' }) -join ''

Write-Host "Cleaned URL (first 30 chars): $($cleaned.Substring(0, [Math]::Min(30, $cleaned.Length)))..."
Set-Content -Path $path -Value $cleaned -Encoding UTF8 -NoNewline
Write-Host "File saved OK: $path"
