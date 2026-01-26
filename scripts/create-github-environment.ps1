Param(
  [Parameter(Mandatory=$true)] [string]$Owner,
  [Parameter(Mandatory=$true)] [string]$Repo,
  [Parameter(Mandatory=$true)] [string]$Environment
)

Write-Host "Creating GitHub environment $Owner/$Repo -> $Environment"

# Ensure gh is available
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) { Write-Error "gh CLI not found. Install and run 'gh auth login' first."; exit 1 }

# Create environment via gh api
gh api --method PUT "/repos/$Owner/$Repo/environments/$Environment" -f wait_timer=0 | Out-Null
Write-Host "Environment created/updated: $Environment"

function Set-EnvSecret([string]$name) {
  $resp = Read-Host "Set $name as environment secret? (y/N)"
  if ($resp -match '^[Yy]') {
    Write-Host "Enter value for $name (end with Ctrl+Z then Enter on Windows):"
    $tmp = [System.IO.Path]::GetTempFileName()
    $content = @()
    while ($true) {
      $line = [Console]::In.ReadLine()
      if ($line -eq $null) { break }
      $content += $line
    }
    $content -join "`n" | Out-File -Encoding utf8 $tmp
    gh secret set $name --env $Environment --body-file $tmp
    Remove-Item $tmp -Force
    Write-Host "$name set."
  }
}

Set-EnvSecret -name 'DATABASE_URL'
Set-EnvSecret -name 'REDIS_URL'
Set-EnvSecret -name 'AZURE_CREDENTIALS'

Write-Host "\nNext: configure protection rules (required reviewers/wait timer/branches) in the GitHub UI or via API."
Write-Host "UI: https://github.com/$Owner/$Repo/settings/environments/$Environment"
Write-Host "If you want scripted protection rules, I can provide gh api examples — ask me to generate them."
