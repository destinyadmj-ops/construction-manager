# 簡易 apply_rollout_local_simple.ps1
# - 複雑な関数や中かっこを避け、PowerShell のパーサ問題を回避します。
# - ローカルの kubectl を使って manifest を適用し、簡単なログを収集します。

param(
    [int]$LogTailSeconds = 30
)

# kubectl が存在するかチェック
if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
    Write-Error "kubectl が見つかりません。kubectl をインストールし、kubeconfig を設定してください。"
    exit 2
}

$ts = (Get-Date).ToString('yyyyMMdd_HHmmss')
$logDir = Join-Path -Path $PWD -ChildPath "logs"
if (-not (Test-Path $logDir)) { New-Item -Path $logDir -ItemType Directory | Out-Null }
$logFile = Join-Path $logDir ("apply_rollout_simple_$ts.log")

"=== BEGIN rollout apply run: $(Get-Date) ===" | Out-File -FilePath $logFile -Encoding utf8

# 1) Apply manifest (バリデーションを無効化)
"--- kubectl apply (validate=false) ---" | Out-File -FilePath $logFile -Append
& kubectl apply -f deploy/argo/rollout_canary.yaml --validate=false 2>&1 | Out-File -FilePath $logFile -Append

Start-Sleep -Seconds 2

# 2) Rollout を取得（CRD が無いとエラーになるがログに残す）
"--- kubectl get rollout (yaml) ---" | Out-File -FilePath $logFile -Append
& kubectl get rollout trading-bot-rollout -n default -o yaml 2>&1 | Out-File -FilePath $logFile -Append

# 3) Pods snapshot
"--- kubectl get pods (label=app=trading-bot) ---" | Out-File -FilePath $logFile -Append
& kubectl get pods -n default -l app=trading-bot -o wide 2>&1 | Out-File -FilePath $logFile -Append

# 4) Pods があればログを取得
$podsRaw = & kubectl get pods -n default -l app=trading-bot -o name 2>$null
if ($LASTEXITCODE -ne 0 -or -not $podsRaw) {
    "No pods found or unable to list pods. Skipping logs capture." | Out-File -FilePath $logFile -Append
} else {
    $podList = $podsRaw -split "`n" | ForEach-Object { $_.Trim() -replace '^pod/','' } | Where-Object { $_ -ne "" }
    $count = 0
    foreach ($pod in $podList) {
        if ($count -ge 5) { break }
        "--- logs for pod: $pod (last ${LogTailSeconds}s) ---" | Out-File -FilePath $logFile -Append
        & kubectl logs -n default $pod --all-containers --timestamps --since ${LogTailSeconds}s 2>&1 | Out-File -FilePath $logFile -Append
        $count++
    }
}

"=== END rollout apply run: $(Get-Date) ===" | Out-File -FilePath $logFile -Append

Write-Host "完了しました。ログファイル: $logFile" -ForegroundColor Green
Write-Host "このログの内容をここに貼ってください。" -ForegroundColor Cyan
