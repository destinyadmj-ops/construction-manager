param(
  [Parameter(Mandatory = $false)]
  [ValidateSet('default', 'expense', 'labor', 'ar')]
  [string]$Key = 'default',

  # Optional: set to match process.env.ADMIN_TOKEN when running in production.
  [Parameter(Mandatory = $false)]
  [string]$AdminToken = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Example bodies you can adjust later.
# These map 1:1 to POST /api/accounting/export and /api/accounting/query bodies.
$bodyByKey = @{
  default = @{ metaKeys = @('project') }
  expense  = @{ accountingType = 'EXPENSE'; metaKeys = @('project') }
  labor    = @{ accountingType = 'LABOR'; metaKeys = @('project') }
  ar       = @{ accountingType = 'ACCOUNTS_RECEIVABLE'; metaKeys = @('project') }
}

if (-not $bodyByKey.ContainsKey($Key)) {
  throw "Unknown Key: $Key"
}

$payload = @{
  key  = $Key
  name = "$Key preset"
  body = $bodyByKey[$Key]
}

$headers = @{}
if ($AdminToken -and $AdminToken.Trim().Length -gt 0) {
  $headers['x-admin-token'] = $AdminToken
}

$json = $payload | ConvertTo-Json -Depth 20

# NOTE: Adjust base URL if you run on a different port.
$uri = 'http://127.0.0.1:3000/api/accounting/export-preset'

Invoke-WebRequest -UseBasicParsing -Method POST -Uri $uri -ContentType 'application/json' -Headers $headers -Body $json |
  Select-Object -ExpandProperty Content |
  Write-Output
