[CmdletBinding()]
param(
    [Parameter()]
    [string]$BaseUrl = 'https://tanaka-bot.org',

    [Parameter()]
    [int]$IntervalSec = 20,

    [Parameter()]
    [int]$MaxChecks = 12,

    [Parameter()]
    [string]$ServerIp = '167.179.65.195',

    [Parameter()]
    [string]$SshUser = 'root',

    [Parameter()]
    [string]$SshKeyPath = "$env:USERPROFILE\.ssh\id_ed25519_root"
)

$ErrorActionPreference = 'Stop'

function Get-MaxTradeId {
    param([array]$Trades)
    if (-not $Trades -or $Trades.Count -eq 0) { return 0 }
    return ($Trades | ForEach-Object { [int]($_.trade_id) } | Measure-Object -Maximum).Maximum
}

function Get-CountMap {
    param([object]$Items)
    $map = @{}
    if (-not $Items) { return $map }
    foreach ($item in @($Items)) {
        $reason = [string]($item.reason)
        $count = [int]($item.count)
        if ([string]::IsNullOrWhiteSpace($reason)) { continue }
        $map[$reason] = $count
    }
    return $map
}

function Get-MapDelta {
    param(
        [hashtable]$Before,
        [hashtable]$After
    )
    $keys = @($Before.Keys + $After.Keys | Sort-Object -Unique)
    $rows = @()
    foreach ($k in $keys) {
        $b = 0
        $a = 0
        if ($Before.ContainsKey($k)) { $b = [int]$Before[$k] }
        if ($After.ContainsKey($k)) { $a = [int]$After[$k] }
        $d = $a - $b
        if ($d -ne 0) {
            $rows += [pscustomobject]@{ reason = $k; before = $b; after = $a; delta = $d }
        }
    }
    return $rows
}

function Get-DecisionStats {
    param([string]$Base)
    $health = Invoke-RestMethod -Method Get -Uri "$Base/healthz"
    $decision = $null
    try {
        $decision = Invoke-RestMethod -Method Get -Uri "$Base/decision-stats"
    }
    catch {
        $decision = $health.decision_stats
    }
    return [pscustomobject]@{
        health = $health
        decision = $decision
    }
}

function Get-Remote429TailCount {
    param(
        [string]$Ip,
        [string]$User,
        [string]$KeyPath
    )
    if (!(Test-Path $KeyPath)) {
        return $null
    }

    $remote = '{0}@{1}' -f $User, $Ip
    $cmd = "journalctl -u webhook_bot_v2.service -n 500 --no-pager | grep -c '429\\|Too Many Requests' || true"
    $output = & ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i $KeyPath $remote $cmd
    if ($LASTEXITCODE -ne 0) {
        return $null
    }

    $text = [string]($output | Select-Object -Last 1)
    $count = 0
    if ([int]::TryParse($text.Trim(), [ref]$count)) {
        return $count
    }
    return $null
}

Write-Output ("OBSERVE_START base={0} interval={1}s checks={2}" -f $BaseUrl, $IntervalSec, $MaxChecks)

$baselineLearning = Invoke-RestMethod -Method Get -Uri "$BaseUrl/learning-summary"
$baselineTradeId = Get-MaxTradeId -Trades $baselineLearning.recent_trades
$baselineStatsWrap = Get-DecisionStats -Base $BaseUrl
$baselineStats = $baselineStatsWrap.decision
$baseline429Tail = Get-Remote429TailCount -Ip $ServerIp -User $SshUser -KeyPath $SshKeyPath

$baseNoSignal = Get-CountMap -Items $baselineStats.no_signal_reasons
$baseBlocked = Get-CountMap -Items $baselineStats.blocked_reasons
$baseRate = Get-CountMap -Items $baselineStats.exchange_rate_limits

Write-Output ("BASELINE trade_id={0} health={1} dry_run={2} recent_errors={3}" -f $baselineTradeId, $baselineStatsWrap.health.status, $baselineStatsWrap.health.dry_run, $baselineStatsWrap.health.recent_error_count)
if ($null -ne $baseline429Tail) {
    Write-Output ("BASELINE_REMOTE_429_TAIL500 {0}" -f $baseline429Tail)
}

for ($i = 1; $i -le $MaxChecks; $i++) {
    Start-Sleep -Seconds $IntervalSec
    try {
        $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/healthz"
        $learning = Invoke-RestMethod -Method Get -Uri "$BaseUrl/learning-summary"
        $tradeId = Get-MaxTradeId -Trades $learning.recent_trades
        $throttle = $health.decision_stats.exchange_throttle
        Write-Output ("CHECK {0}/{1} trade_id={2} ingress={3} err={4} cooldown_ms={5}" -f $i, $MaxChecks, $tradeId, $health.webhook_ingress.status, $health.recent_error_count, $throttle.cooldown_remaining_ms)
    }
    catch {
        Write-Output ("CHECK {0}/{1} error={2}" -f $i, $MaxChecks, $_.Exception.Message)
    }
}

$finalLearning = Invoke-RestMethod -Method Get -Uri "$BaseUrl/learning-summary"
$finalTradeId = Get-MaxTradeId -Trades $finalLearning.recent_trades
$finalStatsWrap = Get-DecisionStats -Base $BaseUrl
$finalStats = $finalStatsWrap.decision
$final429Tail = Get-Remote429TailCount -Ip $ServerIp -User $SshUser -KeyPath $SshKeyPath

$finalNoSignal = Get-CountMap -Items $finalStats.no_signal_reasons
$finalBlocked = Get-CountMap -Items $finalStats.blocked_reasons
$finalRate = Get-CountMap -Items $finalStats.exchange_rate_limits

$deltaNoSignal = Get-MapDelta -Before $baseNoSignal -After $finalNoSignal
$deltaBlocked = Get-MapDelta -Before $baseBlocked -After $finalBlocked
$deltaRate = Get-MapDelta -Before $baseRate -After $finalRate

Write-Output ("SUMMARY trade_id_before={0} trade_id_after={1} delta={2}" -f $baselineTradeId, $finalTradeId, ($finalTradeId - $baselineTradeId))
if (($null -ne $baseline429Tail) -and ($null -ne $final429Tail)) {
    Write-Output ("SUMMARY remote_429_tail500_before={0} after={1} delta={2}" -f $baseline429Tail, $final429Tail, ($final429Tail - $baseline429Tail))
}

Write-Output ("SUMMARY no_signal_delta_count={0} blocked_delta_count={1} rate_limit_delta_count={2}" -f @($deltaNoSignal).Count, @($deltaBlocked).Count, @($deltaRate).Count)
if (@($deltaNoSignal).Count -gt 0) {
    Write-Output 'NO_SIGNAL_DELTA:'
    $deltaNoSignal | ConvertTo-Json -Depth 6 | Write-Output
}
if (@($deltaBlocked).Count -gt 0) {
    Write-Output 'BLOCKED_DELTA:'
    $deltaBlocked | ConvertTo-Json -Depth 6 | Write-Output
}
if (@($deltaRate).Count -gt 0) {
    Write-Output 'RATE_LIMIT_DELTA:'
    $deltaRate | ConvertTo-Json -Depth 6 | Write-Output
}

$topNoSignal = @($finalStats.no_signal_reasons | Select-Object -First 5)
$topBlocked = @($finalStats.blocked_reasons | Select-Object -First 5)
Write-Output ("TOP no_signal={0} blocked={1}" -f @($topNoSignal).Count, @($topBlocked).Count)
if (@($topNoSignal).Count -gt 0) {
    $topNoSignal | ConvertTo-Json -Depth 6 | Write-Output
}
if (@($topBlocked).Count -gt 0) {
    $topBlocked | ConvertTo-Json -Depth 6 | Write-Output
}

Write-Output 'OBSERVE_END'
