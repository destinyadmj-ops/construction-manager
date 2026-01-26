#!/usr/bin/env bash
set -euo pipefail
if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found. Install and authenticate first: https://cli.github.com/" >&2
  exit 1
fi
if [ $# -lt 4 ]; then
  echo "Usage: $0 <owner> <repo> <environment> <required-reviewer1[,reviewer2,...]>" >&2
  echo "Example: $0 destinyadmj-ops construction-manager production alice,bob" >&2
  exit 1
fi
owner=$1
repo=$2
env=$3
IFS=',' read -r -a reviewers <<< "$4"

# Build JSON payload for required reviewers (users only). Teams can be added by modifying the script.
users_json=$(printf '%s\n' "${reviewers[@]}" | jq -R -s -c 'split("\n")[:-1]')

payload=$(jq -n --argjson users "$users_json" '{required_reviewers: {users: $users, teams: []}, wait_timer: {duration: 0}}')

echo "Applying environment protection to $owner/$repo environment '$env' with reviewers: ${reviewers[*]}"

# The endpoint below may require repository admin rights. This uses the REST API path for deployment_protection_rules.
gh api --method POST "/repos/${owner}/${repo}/environments/${env}/deployment_protection_rules" -f body="$payload" || {
  echo "Failed to create protection rule via API. You may need to use the repo UI or run a tailored API call." >&2
  exit 1
}

echo "Protection rule request submitted. Verify in repository Settings → Environments → $env."
