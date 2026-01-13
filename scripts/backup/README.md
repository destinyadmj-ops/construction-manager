# Backup (RPO 1時間: SharePoint)

このフォルダは「PostgreSQLを1時間ごとにダンプして、SharePoint（OneDrive同期）へ保管」するための最小スクリプトです。

## 前提
- DBはPostgreSQL
- サーバー/実行PCに **PostgreSQL client tools**（`pg_dump`）が入っていること（または Docker が使えること）
- SharePointのドキュメントライブラリを **OneDriveクライアントで同期**して、ローカルにフォルダが見えていること

## 使い方（手動）
1) SharePoint同期フォルダ（例）

2) 実行

`DATABASE_URL` を環境変数で持っていない場合は、引数で渡します。

`.env` から読みたい場合（おすすめ: 本番用 `.env.production` を作って渡す）:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup/pg-backup.ps1 `
  -EnvFile ".env.production" `
  -OutDir "C:\SharePoint\MasterHubBackups"
```

通信できないときにハングするのを避けたい場合（既定で 10 秒）:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup/pg-backup.ps1 `
  -EnvFile ".env.production" `
  -OutDir "C:\SharePoint\MasterHubBackups" `
  -ConnectTimeoutSeconds 10
```

補足:

- `pg_dump` が見つからない場合は、Docker の `postgres:16` イメージ上で `pg_dump` を実行してバックアップします。

- `-KeepDays`（既定: 30）: 日次スナップショット（1日1本）を保持

## タスクスケジューラ（推奨）
- トリガー: 1時間ごと
- アクション: `powershell.exe`
- 引数例:
  - `-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\master-hub\scripts\backup\pg-backup.ps1" -OutDir "C:\SharePoint\MasterHubBackups"`

## リストアの考え方（最短）
- 新しいDBを用意 → `.sql.gz` を解凍 → `psql`で流し込み → Web/Worker再起動

注意: 本番のRTO 30分を狙うなら「復元手順を1枚に固定」して、月1回だけでも復元テストを推奨します。
