#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")"/.. && pwd)"
marker="$repo_root/.rollback-checkpoint"
if [ ! -f "$marker" ]; then
  echo "No .rollback-checkpoint found at $marker" >&2
  exit 1
fi

tag=$(head -n 1 "$marker" | tr -d '\n')
echo "Checkpoint tag: $tag"

patch_dir="$repo_root/scripts/pre-restore"
mkdir -p "$patch_dir"

uncommitted_patch="$patch_dir/pre-restore-uncommitted.patch"
staged_patch="$patch_dir/pre-restore-staged.patch"

git diff > "$uncommitted_patch"
git diff --staged > "$staged_patch"

created=false
if [ -s "$uncommitted_patch" ] || [ -s "$staged_patch" ]; then
  (cd "$repo_root" && git add "$uncommitted_patch" "$staged_patch" || true; git commit -m "chore: save pre-restore patches" || true; git push origin HEAD || true)
  created=true
fi

if [ "$created" = true ]; then
  echo "Pre-restore patches saved and pushed."
else
  echo "No pre-restore diffs found; patches created but empty."
fi

if [ "${1-}" != "force" ]; then
  echo "To restore, run:"
  echo "  git fetch origin"
  echo "  git checkout -B restore-checkpoint origin/$tag"
  echo "  git reset --hard origin/$tag"
  echo "Or run this script with 'force' to perform restore now: ./scripts/rollback-prep-and-restore.sh force"
  exit 0
fi

# perform restore
cd "$repo_root"
git fetch origin
git checkout -B restore-checkpoint "origin/$tag"
git reset --hard "origin/$tag"
echo "Restored working tree to origin/$tag. Current branch: $(git rev-parse --abbrev-ref HEAD)"
