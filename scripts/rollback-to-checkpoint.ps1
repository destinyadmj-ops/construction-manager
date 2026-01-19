Param(
  [switch]$Force
)

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$marker = Join-Path $repoRoot '..\.rollback-checkpoint'
if (-not (Test-Path $marker)) {
  Write-Error "No .rollback-checkpoint found at $marker"
  exit 1
}
$tag = (Get-Content $marker | Select-Object -First 1).Trim()
Write-Host "Checkpoint tag: $tag"
if (-not $Force) {
  Write-Host "To restore, run this script with -Force, or run the commands below manually:"
  Write-Host "  git fetch origin"
  Write-Host "  git checkout -B restore-checkpoint origin/$tag"
  Write-Host "  git reset --hard origin/$tag"
  Write-Host "(This will set your working copy to the checkpoint commit.)"
  exit 0
}

git fetch origin
# Create (or update) a local branch 'restore-checkpoint' pointing at the tagged commit on origin
git checkout -B restore-checkpoint origin/$tag
git reset --hard origin/$tag
Write-Host "Restored working tree to origin/$tag. Current branch: $(git rev-parse --abbrev-ref HEAD)"
