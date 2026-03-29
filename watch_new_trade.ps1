param(
    [string]$BaseUrl = "https://tanaka-bot.org",
    [int]$IntervalSec = 20,
    [int]$MaxChecks = 30
)

$ErrorActionPreference = "Stop"

function Get-MaxTradeId {
    param([array]$Trades)
    if (-not $Trades -or $Trades.Count -eq 0) { return 0 }
    return ($Trades | ForEach-Object { [int]($_.trade_id) } | Measure-Object -Maximum).Maximum
}

Write-Output "WATCH_START base=$BaseUrl interval=${IntervalSec}s checks=$MaxChecks"

$summary = Invoke-RestMethod -Method Get -Uri "$BaseUrl/learning-summary"
$lastTradeId = Get-MaxTradeId -Trades $summary.recent_trades
Write-Output "BASELINE last_trade_id=$lastTradeId"

for ($i = 1; $i -le $MaxChecks; $i++) {
    Start-Sleep -Seconds $IntervalSec

    try {
        $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/healthz"
        $sum = Invoke-RestMethod -Method Get -Uri "$BaseUrl/learning-summary"
        $currentTradeId = Get-MaxTradeId -Trades $sum.recent_trades

        if ($currentTradeId -gt $lastTradeId) {
            $latest = ($sum.recent_trades | Sort-Object {[int]$_.trade_id} -Descending | Select-Object -First 1)
            $monitor = Invoke-RestMethod -Method Post -Uri "$BaseUrl/monitor" -TimeoutSec 25

            Write-Output "NEW_TRADE_DETECTED check=$i prev=$lastTradeId now=$currentTradeId"
            Write-Output ("TRADE trade_id={0} alert={1} result={2} roi={3}" -f $latest.trade_id, $latest.alert, $latest.result, $latest.roi)
            Write-Output ("HEALTH status={0} dry_run={1} errors={2}" -f $health.status, $health.dry_run, $health.recent_error_count)
            Write-Output ("MONITOR status={0} errors={1}" -f $monitor.status, ($monitor.errors | Measure-Object).Count)
            break
        }

        Write-Output ("CHECK {0}/{1} no_new_trade last_trade_id={2} health={3} errors={4}" -f $i, $MaxChecks, $currentTradeId, $health.status, $health.recent_error_count)
    }
    catch {
        Write-Output ("CHECK {0}/{1} monitor_error={2}" -f $i, $MaxChecks, $_.Exception.Message)
    }
}

Write-Output "WATCH_END"
