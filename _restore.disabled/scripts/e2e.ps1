param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$PlaywrightArgs
)

$ErrorActionPreference = 'Stop'

# Force UTF-8 output (Windows PowerShell 5.1 friendly)
try {
  $OutputEncoding = [System.Text.Encoding]::UTF8
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
  # ignore
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $repoRoot 'e2e.log'

function Write-LogLine([string]$line) {
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $msg = "[$ts] $line"
  $msg | Out-File -FilePath $logPath -Encoding utf8 -Append
  Write-Output $line
}

Push-Location $repoRoot
try {
  Write-LogLine "--- e2e start: npx playwright test $($PlaywrightArgs -join ' ') ---"

  & npx.cmd playwright test @PlaywrightArgs 2>&1 | ForEach-Object {
    Write-LogLine ("$_")
  }

  $exitCode = $LASTEXITCODE
  Write-LogLine "--- e2e end: exit=$exitCode ---"
  exit $exitCode
} finally {
  Pop-Location
}
