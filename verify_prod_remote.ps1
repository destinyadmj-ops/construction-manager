[CmdletBinding()]
param(
    [Parameter()]
    [string]$ServerIp = '167.179.65.195',

    [Parameter()]
    [string]$SshUser = 'root',

    [Parameter()]
    [string]$SshKeyPath = "$env:USERPROFILE\.ssh\id_ed25519_root",

    [Parameter()]
    [int]$JournalLines = 30
)

$ErrorActionPreference = 'Stop'

if (!(Test-Path $SshKeyPath)) {
    throw "SSH key not found: $SshKeyPath"
}

$remote = '{0}@{1}' -f $SshUser, $ServerIp
$sshArgs = @(
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-i', $SshKeyPath,
    $remote
)

function Invoke-RemoteCheck {
    param(
        [string]$Label,
        [string]$Command
    )

    Write-Output ("=== {0} ===" -f $Label)
    & ssh @sshArgs $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Remote check failed: $Label (exit=$LASTEXITCODE)"
    }
}

Write-Output ("VERIFY_REMOTE_START server={0} user={1} key={2}" -f $ServerIp, $SshUser, $SshKeyPath)

Invoke-RemoteCheck -Label 'SSH' -Command 'echo SSH_OK'
Invoke-RemoteCheck -Label 'SERVICE' -Command 'systemctl is-active webhook_bot_v2.service; systemctl is-active nginx'
Invoke-RemoteCheck -Label 'HEALTHZ_INTERNAL' -Command 'curl -s http://127.0.0.1:5001/healthz'
Invoke-RemoteCheck -Label 'HEALTHCHECK_TIMER' -Command 'systemctl is-active webhook_bot_healthcheck.timer || true'
Invoke-RemoteCheck -Label 'ENV_CORE' -Command "grep -E '^(DRY_RUN|ENABLE_PHASE45|ENABLE_DOTEN|MIN_ORDER_NOTIONAL_USDT|ENTRY_SCORE_THRESHOLD_BASE|TREND_TIME_EXIT_EXTENSION)=' /home/linuxuser/.bitget_env"
Invoke-RemoteCheck -Label 'JOURNAL_TAIL' -Command ("journalctl -u webhook_bot_v2.service -n {0} --no-pager" -f $JournalLines)

Write-Output 'VERIFY_REMOTE_END'