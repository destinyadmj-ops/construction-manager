#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

OUT_DIR="$REPO_ROOT/backups"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$REPO_ROOT")}"
KEEP_DAYS=14
DRY_RUN=0

declare -a EXPLICIT_VOLUMES=()
declare -a VOLUME_SUFFIXES=(masterhub_storage masterhub_outbox masterhub_redisdata)

usage() {
  cat <<'EOF'
Usage: volume-backup.sh [options]

Options:
  --out-dir PATH        Output root directory (volume backups go under PATH/volumes)
  --project-name NAME   Compose project name prefix (default: repo directory name)
  --volume NAME         Explicit Docker volume name (repeatable)
  --keep-days N         Delete volume archives older than N days (default: 14)
  --dry-run             Print commands without creating archives
  -h, --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    --project-name)
      PROJECT_NAME="$2"
      shift 2
      ;;
    --volume)
      EXPLICIT_VOLUMES+=("$2")
      shift 2
      ;;
    --keep-days)
      KEEP_DAYS="$2"
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

resolve_volumes() {
  local -a resolved=()
  local candidate fallback suffix

  if (( ${#EXPLICIT_VOLUMES[@]} > 0 )); then
    printf '%s\n' "${EXPLICIT_VOLUMES[@]}"
    return
  fi

  for suffix in "${VOLUME_SUFFIXES[@]}"; do
    candidate="${PROJECT_NAME}_${suffix}"
    if docker volume inspect "$candidate" >/dev/null 2>&1; then
      resolved+=("$candidate")
      continue
    fi

    fallback="$(docker volume ls --format '{{.Name}}' | grep -E "(^|_)${suffix}$" | head -n 1 || true)"
    if [[ -n "$fallback" ]]; then
      resolved+=("$fallback")
    fi
  done

  printf '%s\n' "${resolved[@]}"
}

sanitize_name() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_'
}

archive_volume() {
  local volume_name="$1"
  local volumes_dir="$2"
  local stamp="$3"
  local safe_name archive_file

  safe_name="$(sanitize_name "$volume_name")"
  archive_file="volume_${safe_name}_${stamp}.tar.gz"

  if (( DRY_RUN == 1 )); then
    echo "[dry-run] docker run --rm -v ${volume_name}:/volume:ro -v ${volumes_dir}:/backup alpine:3.20 sh -lc \"tar -czf /backup/${archive_file} -C /volume .\""
    echo "OK: ${volumes_dir}/${archive_file}"
    return
  fi

  docker run --rm --pull=missing \
    --user "$(id -u):$(id -g)" \
    -v "${volume_name}:/volume:ro" \
    -v "${volumes_dir}:/backup" \
    -e ARCHIVE_FILE="$archive_file" \
    alpine:3.20 \
    sh -lc 'tar -czf "/backup/$ARCHIVE_FILE" -C /volume .'

  echo "OK: ${volumes_dir}/${archive_file}"
}

VOLUMES_DIR="$OUT_DIR/volumes"
mkdir -p "$VOLUMES_DIR"

mapfile -t RESOLVED_VOLUMES < <(resolve_volumes | sed '/^$/d')
if (( ${#RESOLVED_VOLUMES[@]} == 0 )); then
  echo "No Docker volumes resolved. Pass --project-name or --volume explicitly." >&2
  exit 1
fi

STAMP="$(date '+%Y%m%d_%H%M%S')"
for volume_name in "${RESOLVED_VOLUMES[@]}"; do
  echo "Archiving volume: $volume_name"
  archive_volume "$volume_name" "$VOLUMES_DIR" "$STAMP"
done

if (( DRY_RUN == 0 )) && [[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] && (( KEEP_DAYS > 0 )); then
  find "$VOLUMES_DIR" -maxdepth 1 -type f -name 'volume_*.tar.gz' -mtime "+$KEEP_DAYS" -delete
fi

echo "Pruned: 0"