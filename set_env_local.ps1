# set_env_local.ps1
# Supabase DATABASE_URL を .env.local に設定する補助スクリプト

param(
    [Parameter(Mandatory = $false)]
    [string]$DatabaseUrl,

    [Parameter(Mandatory = $false)]
    [string]$RedisUrl = "redis://localhost:6379"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    $DatabaseUrl = Read-Host "Supabase Session Pooler の DATABASE_URL を入力してください"
}

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    throw "DATABASE_URL が空です。"
}

$envLocalPath = Join-Path $PSScriptRoot ".env.local"

$lines = @()
if (Test-Path $envLocalPath) {
    $lines = Get-Content $envLocalPath | Where-Object { $_ -notmatch '^(DATABASE_URL|REDIS_URL)=' }
}

$nextLines = @(
    "DATABASE_URL=\"$DatabaseUrl\"",
    "REDIS_URL=\"$RedisUrl\""
) + $lines

$nextLines | Set-Content $envLocalPath -Encoding UTF8
Write-Host ".env.local を更新しました。" -ForegroundColor Green
