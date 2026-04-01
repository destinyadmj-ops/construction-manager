Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$path = "$env:USERPROFILE\.supabase_database_url"
if (-not (Test-Path -LiteralPath $path)) {
  Write-Error "File not found: $path"
  exit 1
}

$url = (Get-Content -Raw -Encoding UTF8 $path).Trim()
$env:DATABASE_URL = $url

Set-Location (Join-Path $PSScriptRoot '..\..') 

$migrations = @(
  "20251222185935",
  "20251223081421_add_workentry_accounting_fields",
  "20251223085120_accounting_export_preset",
  "20251223100800_site_ledger_repeat_rule",
  "20251223123349_add_site_depreciation_threshold",
  "20251226105607_cd_c_users_desti_master_hub_master_hub_npm_run_db_migrate",
  "20251226120000_add_partner_email",
  "20251226143000_outlook_defaults",
  "20251226190000_add_partner",
  "20251226194500_outlook_send_log",
  "20251227140000_site_alerts_enabled",
  "20251228090000_add_partner_fax",
  "20251229130417_add_timeclock_site_member_permissions",
  "20251229130756_add_stored_document_biz_date",
  "20251229154434_add_can_grant_schedule_edit",
  "20251231120000_add_site_schedule_label_color"
)

Write-Host "Step 1: Marking all $($migrations.Count) migrations as applied (baseline)..." -ForegroundColor Cyan
foreach ($m in $migrations) {
  Write-Host "  resolve --applied $m" -ForegroundColor DarkGray
  npx prisma@6.19.1 migrate resolve --applied $m
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Failed to resolve: $m (exit $LASTEXITCODE) -- continuing"
  }
}

Write-Host "`nStep 2: prisma migrate deploy (should report 0 pending migrations)..." -ForegroundColor Cyan
npx prisma@6.19.1 migrate deploy

Write-Host "`nDone." -ForegroundColor Green
