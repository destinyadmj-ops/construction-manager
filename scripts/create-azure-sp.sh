#!/bin/bash
set -euo pipefail

# Create an Azure service principal for GitHub Actions with Reader role
# Outputs the JSON suitable for AZURE_CREDENTIALS GitHub secret

if [ -z "${1-}" ]; then
  echo "Usage: $0 <sp-name>"
  exit 2
fi
NAME="$1"

echo "Creating service principal: $NAME"
az ad sp create-for-rbac --name "$NAME" --role Reader --sdk-auth

echo "Granting Key Vault secret get/list permissions must be done separately by command similar to:"
echo "  az keyvault set-policy --name <YourKeyVaultName> --spn <appId-or-objectId> --secret-permissions get list"
