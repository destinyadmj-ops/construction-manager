# Backup (DB 1時間 + Volume 日次)

このフォルダは「PostgreSQL を 1 時間ごとにダンプし、さらに Docker volume を日次でアーカイブして、SharePoint（OneDrive同期）などへ保管」するための最小スクリプトです。

## 前提
- DB は PostgreSQL
- 本番のファイル保管は Docker volume に乗っていること
- サーバー/実行PCに **PostgreSQL client tools**（`pg_dump`）が入っていること（または Docker が使えること）
- SharePointのドキュメントライブラリを **OneDriveクライアントで同期**して、ローカルにフォルダが見えていること
- Linux 本番サーバーで定期実行する場合は `docker` と `systemd` が使えること

## 推奨の分け方

- DB バックアップ: 1時間ごと
- Volume バックアップ: 1日1回

この repo の本番では、DB だけでなく `masterhub_storage` / `masterhub_outbox` / `masterhub_redisdata` も保全対象です。

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

- `pg_dump` が見つからない場合は、Docker の PostgreSQL イメージ上で `pg_dump` を実行してバックアップします。
- Supabase / Postgres 17 系を使う本番では、Linux script は既定で `postgres:17` を使います。

- `-KeepDays`（既定: 30）: 日次スナップショット（1日1本）を保持

## Volume バックアップ（日次）

Docker named volume を `.tar.gz` に固めます。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup/volume-backup.ps1 `
  -OutDir "C:\SharePoint\MasterHubBackups"
```

project 名が異なる場合は明示します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup/volume-backup.ps1 `
  -ProjectName "master-hub" `
  -OutDir "C:\SharePoint\MasterHubBackups"
```

Dry run で volume 名だけ確認したい場合:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup/volume-backup.ps1 `
  -ProjectName "master-hub" `
  -OutDir "C:\SharePoint\MasterHubBackups" `
  -DryRun
```

## Linux 本番サーバーでの実行

Ubuntu などの Linux 本番では PowerShell ではなく次の shell script を使います。

DB バックアップ:

```bash
bash scripts/backup/pg-backup.sh \
  --env-file /opt/master-hub/.env.production \
  --out-dir /opt/master-hub/backups
```

Volume バックアップ:

```bash
bash scripts/backup/volume-backup.sh \
  --project-name master-hub \
  --out-dir /opt/master-hub/backups
```

定期実行は `systemd timer` を推奨します。

- DB バックアップ: `OnCalendar=hourly`
- Volume バックアップ: `OnCalendar=*-*-* 03:25:00`

## 外部ストレージ同期（rclone 推奨）

本番サーバーの `/opt/master-hub/backups` を外部ストレージへ送る場合は、`rclone` を使うのが最小です。

1. `rclone` をインストール

```bash
sudo apt-get update -y
sudo apt-get install -y rclone
```

2. `linuxuser` で remote を設定

```bash
rclone config
```

3. 設定テンプレートをコピー

```bash
cp scripts/backup/backup-sync.env.example /opt/master-hub/.backup-sync.env
```

4. `/opt/master-hub/.backup-sync.env` の `BACKUP_SYNC_TARGET` を実際の保存先へ変更

5. dry-run で確認

```bash
bash scripts/backup/sync-backups-rclone.sh \
  --env-file /opt/master-hub/.backup-sync.env \
  --out-dir /opt/master-hub/backups \
  --dry-run
```

6. 問題なければ実行

```bash
bash scripts/backup/sync-backups-rclone.sh \
  --env-file /opt/master-hub/.backup-sync.env \
  --out-dir /opt/master-hub/backups
```

systemd timer の推奨:

- バックアップ生成の後に同期するため、`OnCalendar=*-*-* *:50:00`
- env file が無い間は `ConditionPathExists=/opt/master-hub/.backup-sync.env` を付けてスキップ
- remote 側 retention を使わないなら、`BACKUP_SYNC_DELETE_OLDER_THAN` は空のままでよい

## タスクスケジューラ（推奨）

- DB バックアップ: 1時間ごと
- Volume バックアップ: 1日1回
- アクション: `powershell.exe`

DB の引数例:

- `-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\master-hub\scripts\backup\pg-backup.ps1" -OutDir "C:\SharePoint\MasterHubBackups"`

Volume の引数例:

- `-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\master-hub\scripts\backup\volume-backup.ps1" -ProjectName "master-hub" -OutDir "C:\SharePoint\MasterHubBackups"`

## リストアの考え方（最短）

- DB: 新しい DB を用意 → `.sql.gz` を解凍 → `psql` で流し込み
- Volume: 対象 volume へ `.tar.gz` を展開
- その後 Web / Worker を再起動

復元訓練の固定手順は [RESTORE-DRILL.md](RESTORE-DRILL.md) を参照してください。
