[CmdletBinding()]
param(
    [Parameter()]
    [string]$ServerIp = '167.179.65.195',

    [Parameter()]
    [string]$SshUser = 'root',

    [Parameter()]
    [string]$LocalTuningFile = '.env.production-live',

    [Parameter()]
    [string]$SshKeyPath = "$env:USERPROFILE\.ssh\id_ed25519_root"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $LocalTuningFile)) {
    throw "Local tuning file not found: $LocalTuningFile"
}

$remote = '{0}@{1}' -f $SshUser, $ServerIp
$remoteTuningPath = '{0}:/home/linuxuser/.bitget_env.tuning' -f $remote
$keyArgs = @()
if (Test-Path $SshKeyPath) {
    $keyArgs = @("-i", $SshKeyPath)
}

function Invoke-CheckedCommand {
    param(
        [scriptblock]$Command,
        [string]$Step
    )
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Failed at step: $Step (exit=$LASTEXITCODE)"
    }
}

Write-Output "[1/5] Upload tuning file to remote temp"
Invoke-CheckedCommand -Step "upload tuning" -Command {
    scp @keyArgs $LocalTuningFile $remoteTuningPath
}

Write-Output "[2/5] Merge credentials + tuning safely"
Invoke-CheckedCommand -Step "backup env" -Command {
    ssh @keyArgs $remote "cp /home/linuxuser/.bitget_env /home/linuxuser/.bitget_env.pre_tuning_$(Get-Date -UFormat %s)"
}
Invoke-CheckedCommand -Step "extract credentials" -Command {
    ssh @keyArgs $remote "sed -n '/^BITGET_API_KEY=/p;/^BITGET_API_SECRET=/p;/^BITGET_API_PASSPHRASE=/p;/^WEBHOOK_SECRET=/p' /home/linuxuser/.bitget_env > /home/linuxuser/.bitget_env.creds"
}
Invoke-CheckedCommand -Step "merge env" -Command {
    ssh @keyArgs $remote "cat /home/linuxuser/.bitget_env.creds /home/linuxuser/.bitget_env.tuning > /home/linuxuser/.bitget_env"
}
Invoke-CheckedCommand -Step "sync to .env" -Command {
    ssh @keyArgs $remote "cp /home/linuxuser/.bitget_env /home/linuxuser/.env"
}
Invoke-CheckedCommand -Step "chown env files" -Command {
    ssh @keyArgs $remote "chown linuxuser:linuxuser /home/linuxuser/.bitget_env /home/linuxuser/.env"
}

Write-Output "[3/5] Restart service"
Invoke-CheckedCommand -Step "restart service" -Command {
    ssh @keyArgs $remote "systemctl restart webhook_bot_v2.service"
}

Write-Output "[4/5] Verify service"
Invoke-CheckedCommand -Step "verify service" -Command {
    ssh @keyArgs $remote "systemctl is-active webhook_bot_v2.service"
}

Write-Output "[5/5] Verify healthz"
Invoke-CheckedCommand -Step "healthz" -Command {
    ssh @keyArgs $remote "curl -s http://127.0.0.1:5001/healthz"
}

Write-Output "DONE: Live tuning deployed safely."
