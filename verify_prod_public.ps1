[CmdletBinding()]
param(
    [Parameter()]
    [string]$BaseUrl = 'https://tanaka-bot.org',

    [Parameter()]
    [int]$RecentTrades = 12
)

$ErrorActionPreference = 'Stop'

function Format-AlertLine {
    param(
        [string]$Name,
        [object]$Summary
    )

    if ($null -eq $Summary) {
        return ("{0} closed=0 wins=0 win_rate=0 weight=0" -f $Name)
    }

    return ("{0} closed={1} wins={2} win_rate={3} weight={4}" -f
        $Name,
        $Summary.closed,
        $Summary.wins,
        $Summary.win_rate,
        $Summary.weight)
}

Write-Output ("VERIFY_PUBLIC_START base={0}" -f $BaseUrl)

$health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/healthz"
$learning = Invoke-RestMethod -Method Get -Uri "$BaseUrl/learning-summary"
$monitor = Invoke-RestMethod -Method Post -Uri "$BaseUrl/monitor"
$decision = $null
try {
    $decision = Invoke-RestMethod -Method Get -Uri "$BaseUrl/decision-stats"
}
catch {
    $decision = $health.decision_stats
}

Write-Output ("HEALTH status={0} dry_run={1} recent_errors={2}" -f $health.status, $health.dry_run, $health.recent_error_count)
if ($health.webhook_ingress) {
    Write-Output ("INGRESS status={0} age={1}s ua={2}" -f $health.webhook_ingress.status, $health.webhook_ingress.seconds_since_last_webhook, $health.webhook_ingress.last_source_ua)
}

Write-Output (Format-AlertLine -Name 'ALERT_A' -Summary $learning.summary.alert_a)
Write-Output (Format-AlertLine -Name 'ALERT_B' -Summary $learning.summary.alert_b)
Write-Output (Format-AlertLine -Name 'ALERT_C' -Summary $learning.summary.alert_c)
Write-Output (Format-AlertLine -Name 'ALERT_D' -Summary $learning.summary.alert_d)

$recent = @($learning.recent_trades | Select-Object -Last $RecentTrades)
Write-Output ("RECENT_TRADE_COUNT {0}" -f $recent.Count)
if ($recent.Count -gt 0) {
    $recent | Select-Object trade_id, alert, result, side, symbol, roi, rr | ConvertTo-Json -Depth 6 | Write-Output
}

$monitorErrorCount = @($monitor.errors).Count
Write-Output ("MONITOR status={0} errors={1}" -f $monitor.status, $monitorErrorCount)
if ($monitorErrorCount -gt 0) {
    $monitor.errors | ConvertTo-Json -Depth 8 | Write-Output
}

$noSignalCount = @($decision.no_signal_reasons).Count
$rateLimitCount = @($decision.exchange_rate_limits).Count
Write-Output ("DECISION_STATS no_signal={0} exchange_rate_limits={1}" -f $noSignalCount, $rateLimitCount)
if ($noSignalCount -gt 0) {
    $decision.no_signal_reasons | ConvertTo-Json -Depth 6 | Write-Output
}
if ($rateLimitCount -gt 0) {
    $decision.exchange_rate_limits | ConvertTo-Json -Depth 6 | Write-Output
}

Write-Output 'VERIFY_PUBLIC_END'