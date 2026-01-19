Param(
  [Parameter(Mandatory=$true)]
  [string]$Name
)

Write-Host "Creating Azure service principal: $Name"
$json = az ad sp create-for-rbac --name $Name --role Reader --sdk-auth | Out-String
Write-Host $json

Write-Host "Run the following to grant Key Vault secret permissions (replace values):"
Write-Host "az keyvault set-policy --name <YourKeyVaultName> --spn <appId-or-objectId> --secret-permissions get list"
