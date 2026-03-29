[CmdletBinding()]
param(
    [Parameter()]
    [string]$ServerIp = '167.179.65.195',

    [Parameter()]
    [string]$SshUser = 'root',

    [Parameter()]
    [string]$SshKeyPath = "$env:USERPROFILE\.ssh\id_ed25519_root",

    [Parameter()]
    [string]$LocalWebhookFile = '.\webhook_bot_v2.py',

    [Parameter()]
    [switch]$SkipRestart
)

$ErrorActionPreference = 'Stop'

if (!(Test-Path $SshKeyPath)) {
    throw "SSH key not found: $SshKeyPath"
}
if (!(Test-Path $LocalWebhookFile)) {
    throw "Local webhook file not found: $LocalWebhookFile"
}

$sshExe = "$env:WINDIR\System32\OpenSSH\ssh.exe"
$scpExe = "$env:WINDIR\System32\OpenSSH\scp.exe"
if (!(Test-Path $sshExe)) { $sshExe = 'ssh' }
if (!(Test-Path $scpExe)) { $scpExe = 'scp' }

$remote = '{0}@{1}' -f $SshUser, $ServerIp
$remoteWebhookPath = '/home/linuxuser/webhook_bot_v2.py'
$remoteWebhookTmp = '/home/linuxuser/webhook_bot_v2.py.hotfix.tmp'
$remoteEnvPath = '/home/linuxuser/.bitget_env'
$remoteEnvBackup = "/home/linuxuser/.bitget_env.pre_leverage_hotfix_$(Get-Date -UFormat %s)"
$remoteWebhookBackup = "/home/linuxuser/webhook_bot_v2.py.pre_leverage_hotfix_$(Get-Date -UFormat %s)"
$serviceName = 'webhook_bot_v2.service'

function Invoke-Checked {
    param([scriptblock]$Command, [string]$Step)
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Failed at step: $Step (exit=$LASTEXITCODE)"
    }
}

function Invoke-RemoteCommand {
    param([string]$Step, [string]$Command)
    Invoke-Checked -Step $Step -Command {
        & $sshExe '-T' '-i' $SshKeyPath $remote $Command
    }
}

function Invoke-RemoteScript {
    param(
        [string]$Step,
        [string]$ScriptContent,
        [string]$RemotePath,
        [ValidateSet('bash','python3')]
        [string]$Interpreter = 'bash'
    )

    $localTmp = Join-Path $env:TEMP ("hotfix_{0}" -f ([System.Guid]::NewGuid().ToString('N')))
    if ($Interpreter -eq 'bash') {
        $localTmp = "$localTmp.sh"
    } else {
        $localTmp = "$localTmp.py"
    }

    $normalized = $ScriptContent -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($localTmp, $normalized, (New-Object System.Text.UTF8Encoding($false)))

    try {
        Invoke-Checked -Step "$Step upload" -Command {
            & $scpExe '-i' $SshKeyPath $localTmp ("{0}:{1}" -f $remote, $RemotePath)
        }
        if ($Interpreter -eq 'bash') {
            Invoke-RemoteCommand -Step "$Step exec" -Command ("chmod +x {0}; /bin/bash {0}" -f $RemotePath)
        } else {
            Invoke-RemoteCommand -Step "$Step exec" -Command ("python3 {0}" -f $RemotePath)
        }
    }
    finally {
        if (Test-Path $localTmp) {
            Remove-Item $localTmp -Force -ErrorAction SilentlyContinue
        }
        Invoke-RemoteCommand -Step "$Step cleanup" -Command ("rm -f {0}" -f $RemotePath)
    }
}

Write-Output ("HOTFIX_START server={0} user={1} local={2}" -f $ServerIp, $SshUser, (Resolve-Path $LocalWebhookFile))

Write-Output '[1/7] Upload webhook file to remote temp'
Invoke-Checked -Step 'upload webhook temp' -Command {
    & $scpExe '-i' $SshKeyPath $LocalWebhookFile ("{0}:{1}" -f $remote, $remoteWebhookTmp)
}

Write-Output '[2/7] Backup current webhook/env'
Invoke-RemoteCommand -Step 'backup webhook' -Command ("cp {0} {1}" -f $remoteWebhookPath, $remoteWebhookBackup)
Invoke-RemoteCommand -Step 'backup env' -Command ("cp {0} {1}" -f $remoteEnvPath, $remoteEnvBackup)

Write-Output '[3/7] Apply hotfix env keys (idempotent)'
$envPatchScript = @'
#!/usr/bin/env bash
set -euo pipefail
FILE=/home/linuxuser/.bitget_env
for kv in LEVERAGE_SIREN_MAX=20 LEVERAGE_RIVER_MAX=20 LEVERAGE_RETRY_ON_40797=true LEVERAGE_40797_FALLBACK=20; do
  key=${kv%%=*}
  val=${kv#*=}
  if grep -q "^${key}=" "$FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$FILE"
  else
    echo "${key}=${val}" >> "$FILE"
  fi
done
echo ENV_PATCHED_KEYS_OK
'@
Invoke-RemoteScript -Step 'patch env keys' -ScriptContent $envPatchScript -RemotePath '/tmp/hotfix_env_patch.sh' -Interpreter 'bash'

Write-Output '[4/7] Replace webhook file'
Invoke-RemoteCommand -Step 'replace webhook file' -Command ("mv {0} {1}" -f $remoteWebhookTmp, $remoteWebhookPath)
Invoke-RemoteCommand -Step 'chown files' -Command ("chown linuxuser:linuxuser {0} {1}" -f $remoteWebhookPath, $remoteEnvPath)

if (-not $SkipRestart) {
    Write-Output '[5/7] Restart service'
    Invoke-RemoteCommand -Step 'restart service' -Command ("systemctl restart {0}" -f $serviceName)
} else {
    Write-Output '[5/7] Skip restart requested'
}

Write-Output '[6/7] Service/health verify'
Invoke-RemoteCommand -Step 'service active' -Command ("systemctl is-active {0}" -f $serviceName)

$healthScript = @'
import json
import urllib.request

with urllib.request.urlopen('http://127.0.0.1:5001/healthz', timeout=25) as r:
    o = json.loads(r.read().decode('utf-8'))
print('health_status', o.get('status'), 'dry_run', o.get('dry_run'))
'@
Invoke-RemoteScript -Step 'health check' -ScriptContent $healthScript -RemotePath '/tmp/hotfix_health_check.py' -Interpreter 'python3'

Write-Output '[7/7] Leverage behavior verify (SIREN/RIVER)'
$verifyScript = @'
import json
import sys

sys.path.append('/home/linuxuser')
import webhook_bot_v2 as w

print('LEVERAGE_VERIFY_START')
for sym in ['SIRENUSDT', 'RIVERUSDT']:
    target = int(w._target_leverage(sym, bot_eval=None, atr_ratio=0.0))
    meta = w._prepare_entry_leverage(sym, bot_eval=None, atr_ratio=0.0)
    response = meta.get('response') or {}
    print(json.dumps({
        'symbol': sym,
        'target_leverage': target,
        'applied': bool(meta.get('applied')),
        'applied_leverage': meta.get('applied_leverage'),
        'symbol_cap': meta.get('symbol_cap'),
        'reason': meta.get('reason'),
        'response_code': str(response.get('code', '')),
        'response_msg': str(response.get('msg', '')),
    }, ensure_ascii=False))
print('LEVERAGE_VERIFY_END')
'@
Invoke-RemoteScript -Step 'leverage verify' -ScriptContent $verifyScript -RemotePath '/tmp/hotfix_leverage_verify.py' -Interpreter 'python3'

Write-Output ("HOTFIX_DONE webhook_backup={0} env_backup={1}" -f $remoteWebhookBackup, $remoteEnvBackup)
