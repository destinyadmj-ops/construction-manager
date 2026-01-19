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
if [ "$*" != "force" ]; then
  echo "To restore, run:"
  echo "  git fetch origin"
  echo "  git checkout -B restore-checkpoint origin/$tag"
  echo "  git reset --hard origin/$tag"
  echo "Or run this script with 'force' to perform restore now: ./scripts/rollback-to-checkpoint.sh force"
  exit 0
fi

git fetch origin
git checkout -B restore-checkpoint "origin/$tag"
git reset --hard "origin/$tag"
echo "Restored working tree to origin/$tag. Current branch: $(git rev-parse --abbrev-ref HEAD)"
