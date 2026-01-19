Param(
  [Parameter(Mandatory = $false)]
  [string]$Name
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-MigrationName() {
  while ($true) {
    $n = Read-Host "Migration name (lowercase letters/numbers/_/-)"
    if ([string]::IsNullOrWhiteSpace($n)) {
      Write-Host "Name is required." -ForegroundColor Yellow
      continue
    }
    if ($n.Length -gt 64) {
      Write-Host "Name too long (max 64)." -ForegroundColor Yellow
      continue
    }
    if ($n -notmatch '^[a-z0-9_-]+$') {
      Write-Host "Invalid name. Use lowercase letters, numbers, '_' or '-'." -ForegroundColor Yellow
      continue
    }
    return $n
  }
}

try {
  if ([string]::IsNullOrWhiteSpace($Name)) {
    $Name = Read-MigrationName
  }

  Write-Host "Running: prisma migrate dev --skip-generate --name $Name" -ForegroundColor Cyan
  npx prisma migrate dev --skip-generate --name $Name
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
