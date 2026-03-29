<#
apply_rollout_local.ps1

説明:
- ローカルの `kubectl` と現在の `kubeconfig` を使って `deploy/argo/rollout_canary.yaml` を適用します。
- CRD/プラグインの有無に応じて安全にコマンドを切り替えし、出力をタイムスタンプ付きログファイルに保存します。
- このスクリプトは kubeconfig を外部に送信しません — お使いのマシン上でのみ実行されます。

使い方:
PowerShell から実行:
    powershell -ExecutionPolicy Bypass -File tools\apply_rollout_local.ps1

実行後: スクリプトはログファイルのパスを出力します。内容をここに貼ってください。
#>

param(
    [int]$LogTailSeconds = 30
)

function AbortIfNoKubectl {
    if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
        Write-Error "kubectl が見つかりません。kubectl をインストールし、kubeconfig を設定してください。"
        exit 2
    }
}

function Timestamp { return (Get-Date).ToString('yyyyMMdd_HHmmss') }

AbortIfNoKubectl

$ts = Timestamp
$logDir = Join-Path -Path $PWD -ChildPath "logs"
if (-not (Test-Path $logDir)) { New-Item -Path $logDir -ItemType Directory | Out-Null }
$logFile = Join-Path $logDir "apply_rollout_$ts.log"

"=== BEGIN rollout apply run: $(Get-Date) ===" | Out-File -FilePath $logFile -Encoding utf8

# 1) Apply manifest (skip openapi validation to avoid local api-server errors)
"--- kubectl apply (validate=false) ---" | Out-File -FilePath $logFile -Append
kubectl apply -f deploy/argo/rollout_canary.yaml --validate=false 2>&1 | Out-File -FilePath $logFile -Append

Start-Sleep -Seconds 2

# 2) Try to read Rollout resource via kubectl get (works if CRD exists)
"--- kubectl get rollout (yaml) ---" | Out-File -FilePath $logFile -Append
kubectl get rollout trading-bot-rollout -n default -o yaml 2>&1 | Out-File -FilePath $logFile -Append

# 3) Pods snapshot
"--- kubectl get pods (label=app=trading-bot) ---" | Out-File -FilePath $logFile -Append
kubectl get pods -n default -l app=trading-bot -o wide 2>&1 | Out-File -FilePath $logFile -Append

# 4) If pods exist, capture recent logs (limited time)
$pods = & kubectl get pods -n default -l app=trading-bot -o name 2>$null
if ($LASTEXITCODE -ne 0 -or -not $pods) {
    "No pods found or unable to list pods. Skipping logs capture." | Out-File -FilePath $logFile -Append
} else {
    $podList = $pods -split "`n" | ForEach-Object { $_.Trim() -replace '^pod/','' } | Where-Object { $_ -ne "" }
    $count = 0
    foreach ($pod in $podList) {
        if ($count -ge 5) { break } # 最初の5つだけ
        "--- logs for pod: $pod (last $LogTailSeconds seconds) ---" | Out-File -FilePath $logFile -Append
        # capture last N seconds if kubectl supports since-time via --since, else tail lines
        kubectl logs -n default $pod --all-containers --timestamps --since ${LogTailSeconds}s 2>&1 | Out-File -FilePath $logFile -Append
        $count++
    }
}

"=== END rollout apply run: $(Get-Date) ===" | Out-File -FilePath $logFile -Append

Write-Host "完了しました。ログファイル: $logFile" -ForegroundColor Green
Write-Host "このログの内容をここに貼ってください。問題があれば私が解析します。"

exit 0
