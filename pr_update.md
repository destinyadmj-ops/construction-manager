PR checklist and notes:

- [ ] Review the Azure Key Vault workflow and confirm `AZURE_KEYVAULT_NAME` and `AZURE_CREDENTIALS` will be provided in repository secrets.
- [ ] Confirm GitHub Environment `production` exists and protection rules (required reviewers, wait timer) are set.
- [ ] Ensure necessary environment secrets are added to the Environment (or repo secrets): `DATABASE_URL`, `REDIS_URL`, `NEXT_PUBLIC_APP_NAME`, `ACCOUNTING_PROVIDER`.
- [ ] If using AWS Secrets workflow, ensure `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set and that the secret `my/app/prod` contains required keys.
- [ ] Run CI (or dispatch workflow) to verify `.env.production` generation and successful build.

Docs:
- ENV management: docs/ENV_MANAGEMENT.md
- GitHub Environment setup: docs/GITHUB_ENVIRONMENT_SETUP.md

Notes for ops:
- To create Azure SP (example): `az ad sp create-for-rbac --name "gh-action-keyvault" --role Reader --sdk-auth` and store JSON to `AZURE_CREDENTIALS` secret.
- Use `gh secret set <NAME> --env production` to set environment secrets via CLI.
