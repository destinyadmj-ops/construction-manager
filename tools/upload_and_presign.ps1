<#
upload_and_presign.ps1

- deploy-agent.kubeconfig を S3 にアップロードし、presigned URL を作成して表示します。
- 実行後にローカルファイルを削除するか確認します（デフォルト: 削除する）。
- 前提: aws CLI がインストールされ、認証済みであること。
#>

param(
    [string]$File = ".\deploy-agent.kubeconfig",
    [string]$Bucket = "",
    [string]$Path = "",
    [int]$ExpiresIn = 3600,
    [switch]$NoDelete
)

function ExitWith($msg, $code=1) {
    Write-Host $msg -ForegroundColor Red
    exit $code
}

# check aws
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    ExitWith "aws CLI が見つかりません。インストールしてから再実行してください。"
}

if (-not (Test-Path $File)) {
    ExitWith "ファイルが見つかりません: $File"
}

if ([string]::IsNullOrWhiteSpace($Bucket)) {
    $Bucket = Read-Host "S3 バケット名を入力してください（例: my-bucket）"
}
if ([string]::IsNullOrWhiteSpace($Path)) {
    $Path = Read-Host "S3 内のパスを入力してください（例: path/deploy-agent.kubeconfig）"
}

$S3Key = "$Path".Trim('/\\')
$S3Uri = "s3://$Bucket/$S3Key"

Write-Host "アップロード先: $S3Uri"

# upload
$copyCmd = "aws s3 cp `"$File`" `"$S3Uri`" --acl private --sse AES256"
Write-Host "実行: $copyCmd"
$copy = Invoke-Expression $copyCmd
if ($LASTEXITCODE -ne 0) {
    ExitWith "S3 へのアップロードに失敗しました。`n$copy"
}

# presign
$presignCmd = "aws s3 presign `"$S3Uri`" --expires-in $ExpiresIn"
Write-Host "presign 実行: $presignCmd"
$presigned = Invoke-Expression $presignCmd 2>&1
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($presigned)) {
    ExitWith "presign に失敗しました。`n$presigned"
}

Write-Host "Presigned URL:" -ForegroundColor Green
Write-Host $presigned -ForegroundColor Cyan

if (-not $NoDelete) {
    $del = Read-Host "ローカルファイル $File を削除しますか？ (y/n)"
    if ($del -match '^[yY]') {
        Remove-Item $File -Force
        Write-Host "ローカルファイルを削除しました。"
    } else {
        Write-Host "ローカルファイルを保持します。"
    }
}

Write-Host "処理完了。presigned URL をここに貼ってください。" -ForegroundColor Yellow
