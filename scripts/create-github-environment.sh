#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/create-github-environment.sh <owner> <repo> <environment>
# Example:
#   ./scripts/create-github-environment.sh destinyadmj-ops construction-manager production

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 <owner> <repo> <environment>"
  exit 2
fi

OWNER="$1"
REPO="$2"
ENV_NAME="$3"

echo "Creating GitHub environment $OWNER/$REPO -> $ENV_NAME"

gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated. Run 'gh auth login' first."; exit 3; }

# Create (or update) environment
echo "-> Creating environment (PUT)
"
gh api --method PUT "/repos/${OWNER}/${REPO}/environments/${ENV_NAME}" \
  -f "wait_timer=0" >/dev/null

echo "Environment created/updated: ${ENV_NAME}"

# Prompt for common secrets and set them to environment secrets
read -r -p "Set DATABASE_URL as environment secret? (y/N): " ans
if [[ "$ans" =~ ^[Yy]$ ]]; then
  echo "Enter DATABASE_URL (will be stored as environment secret):"
  read -r dburl
  echo "$dburl" | gh secret set DATABASE_URL --env "$ENV_NAME" --body -
  echo "DATABASE_URL set."
fi

read -r -p "Set REDIS_URL as environment secret? (y/N): " ans
if [[ "$ans" =~ ^[Yy]$ ]]; then
  echo "Enter REDIS_URL (will be stored as environment secret):"
  read -r redisurl
  echo "$redisurl" | gh secret set REDIS_URL --env "$ENV_NAME" --body -
  echo "REDIS_URL set."
fi

read -r -p "Set AZURE_CREDENTIALS as environment secret? (y/N): " ans
if [[ "$ans" =~ ^[Yy]$ ]]; then
  echo "Paste AZURE_CREDENTIALS JSON (single line or multi-line, end with EOF on its own line):"
  tmpfile=$(mktemp)
  cat > "$tmpfile"
  gh secret set AZURE_CREDENTIALS --env "$ENV_NAME" --body-file "$tmpfile"
  rm -f "$tmpfile"
  echo "AZURE_CREDENTIALS set."
fi

# Print next steps for protection rules (manual or gh api)
cat <<'EOF'

Next: protection rules (required reviewers, wait timer, allowed branches).
These must be configured in the GitHub UI or via GH API with appropriate payloads.
Example manual steps (UI):
  1. Go to https://github.com/<owner>/<repo>/settings/environments/<environment>
  2. Under "Protection rules" add Required reviewers, set Wait timer, and restrict branches.

If you want to set required reviewers via API, you can run (adjust payload as needed):

# Example: add a required reviewer (team or user) via gh api
# NOTE: API endpoints for deployment protection rules are sensitive to format and may require admin permissions.
# The following is an example command you can adapt (it does not run automatically):
# gh api --method POST /repos/${OWNER}/${REPO}/environments/${ENV_NAME}/deployment_protection_rules -f \ \
#   '{"protection_rule":{"required_approving_review_count":1,"pattern":"*","requires_approval":true}}'

Refer to GitHub REST API docs and the repository admin to apply protection rules programmatically.

EOF

echo "Done. Environment: ${ENV_NAME}"
