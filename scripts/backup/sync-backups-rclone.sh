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
    or
  BACKUP_SYNC_PROVIDER      r2 or s3
  BACKUP_SYNC_BUCKET        Destination bucket name

Optional env vars:
  BACKUP_SYNC_SOURCE        Override local source directory (default: --out-dir value)
  RCLONE_CONFIG_FILE        Explicit path to rclone.conf
  BACKUP_SYNC_DELETE_OLDER_THAN  Remote retention threshold, e.g. 90d
  BACKUP_SYNC_BWLIMIT       rclone --bwlimit value, e.g. 8M
  BACKUP_SYNC_REMOTE_NAME   Remote name for env-defined S3 backend (default: backupsync)
  BACKUP_SYNC_PREFIX        Destination prefix inside the bucket, e.g. masterhub/prod
  BACKUP_SYNC_ACCESS_KEY_ID S3/R2 access key
  BACKUP_SYNC_SECRET_ACCESS_KEY  S3/R2 secret key
  BACKUP_SYNC_SESSION_TOKEN Optional AWS session token
  BACKUP_SYNC_REGION        e.g. auto for R2, ap-northeast-1 for AWS S3
  BACKUP_SYNC_ENDPOINT      Required for R2, optional for AWS S3
  BACKUP_SYNC_NO_CHECK_BUCKET  true/false
  BACKUP_SYNC_STORAGE_CLASS e.g. STANDARD_IA for AWS S3
  BACKUP_SYNC_SERVER_SIDE_ENCRYPTION  e.g. AES256 or aws:kms
  BACKUP_SYNC_SSE_KMS_KEY_ID Optional AWS KMS key ARN
EOF
}

set_remote_env_var() {
  local key="$1"
  local value="$2"

  printf -v "$key" '%s' "$value"
  export "$key"
}

configure_s3_remote_from_env() {
  local provider="$1"
  local remote_name="$2"
  local access_key_id="$3"
  local secret_access_key="$4"
  local session_token="$5"
  local region="$6"
  local endpoint="$7"
  local no_check_bucket="$8"
  local storage_class="$9"
  local server_side_encryption="${10}"
  local sse_kms_key_id="${11}"
  local env_auth="${12}"
  local remote_env_name
  local provider_name

  if [[ ! "$remote_name" =~ ^[A-Za-z0-9_]+$ ]]; then
    echo "BACKUP_SYNC_REMOTE_NAME must contain only letters, digits, or underscores: $remote_name" >&2
    exit 1
  fi

  remote_env_name="$(printf '%s' "$remote_name" | tr '[:lower:]' '[:upper:]')"

  case "$provider" in
    r2|R2|cloudflare|Cloudflare|cloudflare-r2|Cloudflare-R2)
      provider_name="Cloudflare"
      if [[ -z "$region" ]]; then
        region="auto"
      fi
      if [[ -z "$endpoint" ]]; then
        echo "BACKUP_SYNC_ENDPOINT is required when BACKUP_SYNC_PROVIDER is r2" >&2
        exit 1
      fi
      if [[ -z "$no_check_bucket" ]]; then
        no_check_bucket="true"
      fi
      ;;
    s3|S3|aws|AWS|aws-s3|AWS-S3)
      provider_name="AWS"
      if [[ -z "$region" ]]; then
        echo "BACKUP_SYNC_REGION is required when BACKUP_SYNC_PROVIDER is s3" >&2
        exit 1
      fi
      ;;
    *)
      echo "Unsupported BACKUP_SYNC_PROVIDER: $provider (expected: r2 or s3)" >&2
      exit 1
      ;;
  esac

  if [[ "$env_auth" != "true" && "$env_auth" != "false" ]]; then
    echo "BACKUP_SYNC_ENV_AUTH must be true or false" >&2
    exit 1
  fi

  if [[ "$env_auth" != "true" ]]; then
    if [[ -z "$access_key_id" || -z "$secret_access_key" ]]; then
      echo "BACKUP_SYNC_ACCESS_KEY_ID and BACKUP_SYNC_SECRET_ACCESS_KEY are required unless BACKUP_SYNC_ENV_AUTH=true" >&2
      exit 1
    fi
  fi

  set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_TYPE" "s3"
  set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_PROVIDER" "$provider_name"
  set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_ENV_AUTH" "$env_auth"
  set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_ACL" "private"

  if [[ "$env_auth" != "true" ]]; then
    set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_ACCESS_KEY_ID" "$access_key_id"
    set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_SECRET_ACCESS_KEY" "$secret_access_key"
  fi
  if [[ -n "$session_token" ]]; then
    set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_SESSION_TOKEN" "$session_token"
  fi
  if [[ -n "$region" ]]; then
    set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_REGION" "$region"
  fi
  if [[ -n "$endpoint" ]]; then
    set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_ENDPOINT" "$endpoint"
  fi
  if [[ -n "$no_check_bucket" ]]; then
    set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_NO_CHECK_BUCKET" "$no_check_bucket"
  fi
  if [[ -n "$storage_class" ]]; then
    set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_STORAGE_CLASS" "$storage_class"
  fi
  if [[ -n "$server_side_encryption" ]]; then
    set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_SERVER_SIDE_ENCRYPTION" "$server_side_encryption"
  fi
  if [[ -n "$sse_kms_key_id" ]]; then
    set_remote_env_var "RCLONE_CONFIG_${remote_env_name}_SSE_KMS_KEY_ID" "$sse_kms_key_id"
  fi
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
PROVIDER="${BACKUP_SYNC_PROVIDER:-}"
REMOTE_NAME="${BACKUP_SYNC_REMOTE_NAME:-backupsync}"
BUCKET="${BACKUP_SYNC_BUCKET:-}"
PREFIX="${BACKUP_SYNC_PREFIX:-}"
ACCESS_KEY_ID="${BACKUP_SYNC_ACCESS_KEY_ID:-}"
SECRET_ACCESS_KEY="${BACKUP_SYNC_SECRET_ACCESS_KEY:-}"
SESSION_TOKEN="${BACKUP_SYNC_SESSION_TOKEN:-}"
REGION="${BACKUP_SYNC_REGION:-}"
ENDPOINT="${BACKUP_SYNC_ENDPOINT:-}"
NO_CHECK_BUCKET="${BACKUP_SYNC_NO_CHECK_BUCKET:-}"
STORAGE_CLASS="${BACKUP_SYNC_STORAGE_CLASS:-}"
SERVER_SIDE_ENCRYPTION="${BACKUP_SYNC_SERVER_SIDE_ENCRYPTION:-}"
SSE_KMS_KEY_ID="${BACKUP_SYNC_SSE_KMS_KEY_ID:-}"
ENV_AUTH="${BACKUP_SYNC_ENV_AUTH:-false}"

if [[ -n "$PROVIDER" ]]; then
  configure_s3_remote_from_env \
    "$PROVIDER" \
    "$REMOTE_NAME" \
    "$ACCESS_KEY_ID" \
    "$SECRET_ACCESS_KEY" \
    "$SESSION_TOKEN" \
    "$REGION" \
    "$ENDPOINT" \
    "$NO_CHECK_BUCKET" \
    "$STORAGE_CLASS" \
    "$SERVER_SIDE_ENCRYPTION" \
    "$SSE_KMS_KEY_ID" \
    "$ENV_AUTH"

  if [[ -z "$TARGET" ]]; then
    if [[ -z "$BUCKET" ]]; then
      echo "BACKUP_SYNC_BUCKET is required when BACKUP_SYNC_PROVIDER is set and BACKUP_SYNC_TARGET is omitted" >&2
      exit 1
    fi

    TARGET="${REMOTE_NAME}:${BUCKET}"
    if [[ -n "$PREFIX" ]]; then
      TARGET+="/${PREFIX#/}"
    fi
  fi
fi

if [[ -z "$TARGET" ]]; then
  echo "Set BACKUP_SYNC_TARGET or BACKUP_SYNC_PROVIDER + BACKUP_SYNC_BUCKET in $ENV_FILE" >&2
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