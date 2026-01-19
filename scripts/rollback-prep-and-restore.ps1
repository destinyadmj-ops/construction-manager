Param(
  [switch]$Force
)

# repo root
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$marker = Join-Path $repoRoot '.rollback-checkpoint'
if (-not (Test-Path $marker)) {
  Write-Error "No .rollback-checkpoint found at $marker"
  exit 1
}
$tag = (Get-Content $marker | Select-Object -First 1).Trim()
Write-Host "Checkpoint tag: $tag"

# Save pre-restore patches
$patchDir = Join-Path $scriptDir 'pre-restore'
if (-not (Test-Path $patchDir)) { New-Item -ItemType Directory -Path $patchDir | Out-Null }
$uncommittedPatch = Join-Path $patchDir 'pre-restore-uncommitted.patch'
$stagedPatch = Join-Path $patchDir 'pre-restore-staged.patch'

Write-Host "Creating patches: $uncommittedPatch, $stagedPatch"
git diff > $uncommittedPatch
git diff --staged > $stagedPatch

# If patches are non-empty, add & commit them so they are preserved on remote
$created = $false
if ((Test-Path $uncommittedPatch -PathType Leaf -ErrorAction SilentlyContinue) -and ((Get-Item $uncommittedPatch).Length -gt 0) -or (Test-Path $stagedPatch -PathType Leaf -ErrorAction SilentlyContinue) -and ((Get-Item $stagedPatch).Length -gt 0)) {
  Push-Location $repoRoot
  try {
    git add (Resolve-Path $uncommittedPatch).Path (Resolve-Path $stagedPatch).Path
    git commit -m "chore: save pre-restore patches" | Out-Null
    git push origin HEAD | Out-Null
    $created = $true
  } catch {
    Write-Host "Warning: failed to commit/push patches: $_"
  } finally {
    Pop-Location
  }
}

if ($created) { Write-Host "Pre-restore patches saved and pushed." } else { Write-Host "No pre-restore diffs found; patches created but empty." }

if (-not $Force) {
  Write-Host "To restore, run this script with -Force, or run the commands below manually:"
  Write-Host "  git fetch origin"
  Write-Host "  git checkout -B restore-checkpoint origin/$tag"
  Write-Host "  git reset --hard origin/$tag"
  Write-Host "(This will set your working copy to the checkpoint commit.)"
  exit 0
}

# Perform restore
git fetch origin
git checkout -B restore-checkpoint origin/$tag
git reset --hard origin/$tag
Write-Host "Restored working tree to origin/$tag. Current branch: $(git rev-parse --abbrev-ref HEAD)"
