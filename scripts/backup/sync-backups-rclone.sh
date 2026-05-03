#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

ENV_FILE="$REPO_ROOT/.backup-sync.env"
OUT_DIR="$REPO_ROOT/backups"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: sync-backups-rclone.sh [options]

Options:
  --env-file PATH     Path to shell-style env file
  --out-dir PATH      Local backup root directory (default: ./backups)
  --dry-run           Run rclone in dry-run mode
  -h, --help          Show this help

Required env vars:
  BACKUP_SYNC_TARGET        Full rclone target, e.g. remote-name:masterhub/prod

Optional env vars:
  BACKUP_SYNC_SOURCE        Override local source directory (default: --out-dir value)
  RCLONE_CONFIG_FILE        Explicit path to rclone.conf
  BACKUP_SYNC_DELETE_OLDER_THAN  Remote retention threshold, e.g. 90d
  BACKUP_SYNC_BWLIMIT       rclone --bwlimit value, e.g. 8M
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone is not installed. Install it first (e.g. sudo apt-get install -y rclone)." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

SOURCE_DIR="${BACKUP_SYNC_SOURCE:-$OUT_DIR}"
TARGET="${BACKUP_SYNC_TARGET:-}"
RCLONE_CONFIG_FILE="${RCLONE_CONFIG_FILE:-}"
DELETE_OLDER_THAN="${BACKUP_SYNC_DELETE_OLDER_THAN:-}"
BWLIMIT="${BACKUP_SYNC_BWLIMIT:-}"

if [[ -z "$TARGET" ]]; then
  echo "BACKUP_SYNC_TARGET is not set in $ENV_FILE" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

rclone_cmd=(rclone)
if [[ -n "$RCLONE_CONFIG_FILE" ]]; then
  rclone_cmd+=(--config "$RCLONE_CONFIG_FILE")
fi

copy_cmd=("${rclone_cmd[@]}" copy "$SOURCE_DIR" "$TARGET" --fast-list --transfers 4 --checkers 8 --create-empty-src-dirs)
if [[ -n "$BWLIMIT" ]]; then
  copy_cmd+=(--bwlimit "$BWLIMIT")
fi
if (( DRY_RUN == 1 )); then
  copy_cmd+=(--dry-run)
fi

echo "Syncing backups: $SOURCE_DIR -> $TARGET"
"${copy_cmd[@]}"

if [[ -n "$DELETE_OLDER_THAN" ]]; then
  delete_cmd=("${rclone_cmd[@]}" delete "$TARGET" --min-age "$DELETE_OLDER_THAN" --rmdirs)
  if (( DRY_RUN == 1 )); then
    delete_cmd+=(--dry-run)
  fi

  echo "Pruning remote backups older than $DELETE_OLDER_THAN"
  "${delete_cmd[@]}"
fi

echo "Backup sync completed"