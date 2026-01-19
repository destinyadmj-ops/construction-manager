Param(
  [string]$Owner,
  [string]$Repo,
  [string]$Environment,
  [string[]]$Reviewers
)

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Error "gh CLI not found. Install and authenticate first: https://cli.github.com/"
  exit 1
}
if (-not $Owner -or -not $Repo -or -not $Environment -or -not $Reviewers) {
  Write-Host "Usage: .\set-github-environment-protection.ps1 -Owner <owner> -Repo <repo> -Environment <env> -Reviewers user1,user2"
  exit 1
}

$usersJson = ($Reviewers | ConvertTo-Json -Compress)
$payload = @{ required_reviewers = @{ users = $Reviewers; teams = @() }; wait_timer = @{ duration = 0 } } | ConvertTo-Json -Compress

Write-Host "Applying environment protection to $Owner/$Repo environment '$Environment' with reviewers: $($Reviewers -join ',')"

try {
  gh api --method POST "/repos/$Owner/$Repo/environments/$Environment/deployment_protection_rules" -f body="$payload"
  Write-Host "Protection rule request submitted. Verify in repository Settings → Environments → $Environment."
} catch {
  Write-Error "Failed to create protection rule via API. You may need to use the repo UI or run a tailored API call. $_"
  exit 1
}
