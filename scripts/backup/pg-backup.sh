#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

ENV_FILE="$REPO_ROOT/.env.production"
OUT_DIR="$REPO_ROOT/backups"
CONNECT_TIMEOUT_SECONDS=10
KEEP_HOURS=48
KEEP_DAYS=30

usage() {
  cat <<'EOF'
Usage: pg-backup.sh [options]

Options:
  --env-file PATH                 Path to .env.production style file
  --out-dir PATH                  Output root directory (db backups go under PATH/db)
  --connect-timeout-seconds N     pg_dump connect timeout seconds (default: 10)
  --keep-hours N                  Number of hourly backups to keep (default: 48)
  --keep-days N                   Number of daily snapshots to keep (default: 30)
  -h, --help                      Show this help
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
    --connect-timeout-seconds)
      CONNECT_TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --keep-hours)
      KEEP_HOURS="$2"
      shift 2
      ;;
    --keep-days)
      KEEP_DAYS="$2"
      shift 2
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

normalize_database_url() {
  local url="$1"
  local base query
  local -a kept=()

  if [[ "$url" != *\?* ]]; then
    printf '%s' "$url"
    return
  fi

  base="${url%%\?*}"
  query="${url#*\?}"

  IFS='&' read -r -a parts <<< "$query"
  for part in "${parts[@]}"; do
    [[ -z "$part" ]] && continue
    [[ "$part" == schema=* ]] && continue
    kept+=("$part")
  done

  if (( ${#kept[@]} == 0 )); then
    printf '%s' "$base"
    return
  fi

  local joined
  joined="$(IFS='&'; printf '%s' "${kept[*]}")"
  printf '%s?%s' "$base" "$joined"
}

prune_backups() {
  local backup_dir="$1"
  local keep_hours="$2"
  local keep_days="$3"
  local removed=0
  local -a files=()
  local -a daily_days=()
  declare -A keep_map=()
  declare -A daily_map=()

  while IFS= read -r file; do
    files+=("$file")
  done < <(find "$backup_dir" -maxdepth 1 -type f -name 'backup_*.sql.gz' -printf '%f\n' | sort -r)

  for ((i = 0; i < keep_hours && i < ${#files[@]}; i++)); do
    keep_map["${files[$i]}"]=1
  done

  for file in "${files[@]}"; do
    if [[ "$file" =~ ^backup_([0-9]{8})_[0-9]{2}\.sql\.gz$ ]]; then
      day="${BASH_REMATCH[1]}"
      if [[ -z "${daily_map[$day]:-}" ]] && (( ${#daily_days[@]} < keep_days )); then
        daily_map["$day"]=1
        daily_days+=("$day")
        keep_map["$file"]=1
      fi
    fi
  done

  for file in "${files[@]}"; do
    [[ -n "${keep_map[$file]:-}" ]] && continue
    rm -f "$backup_dir/$file"
    removed=$((removed + 1))
  done

  printf '%s' "$removed"
}

mkdir -p "$OUT_DIR/db"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set in $ENV_FILE" >&2
  exit 1
fi

BACKUP_DIR="$OUT_DIR/db"
STAMP="$(date '+%Y%m%d_%H')"
BACKUP_FILE="backup_${STAMP}.sql.gz"
NORMALIZED_DATABASE_URL="$(normalize_database_url "$DATABASE_URL")"

docker run --rm --pull=missing \
  -e DATABASE_URL="$NORMALIZED_DATABASE_URL" \
  -e PGCONNECT_TIMEOUT="$CONNECT_TIMEOUT_SECONDS" \
  -e BACKUP_FILE="$BACKUP_FILE" \
  -v "$BACKUP_DIR:/backup" \
  postgres:16 \
  sh -lc 'pg_dump "$DATABASE_URL" --no-owner --no-privileges --format=p | gzip -c > "/backup/$BACKUP_FILE"'

REMOVED="$(prune_backups "$BACKUP_DIR" "$KEEP_HOURS" "$KEEP_DAYS")"

echo "OK: $BACKUP_DIR/$BACKUP_FILE"
echo "Pruned: $REMOVED"