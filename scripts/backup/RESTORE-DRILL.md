# Restore Drill

この手順は「DB バックアップ + Docker volume バックアップ」から本番を復元できることを月1回確認するための固定 runbook です。

## 対象

- DB ダンプ: `backup_YYYYMMDD_HH.sql.gz`
- Volume アーカイブ: `volume_<name>_YYYYMMDD_HHMMSS.tar.gz`

最低でも次の volume を確認します。

- `masterhub_storage`
- `masterhub_outbox`
- `masterhub_redisdata`

## Drill の原則

- いきなり本番 volume を上書きしない
- まずは別 DB / 別 volume 名で復元して整合性を確認する
- 完了条件を毎回同じにする

## 事前準備

1. 復元に使う最新の `.sql.gz` と `.tar.gz` を 1 セット選ぶ
2. 本番 compose project 名を確認する
3. 本番と分離した検証先 DB を 1 つ用意する
4. Docker が使える端末を用意する

## DB 復元確認

1. `.sql.gz` を解凍する
2. 検証先 DB に `psql` で流し込む
3. 主要テーブル件数を確認する
4. Prisma migrate deploy が不要か確認する

## Volume 復元確認

1. 復元用の volume を新規作成する

```powershell
docker volume create master-hub_masterhub_storage_restore
docker volume create master-hub_masterhub_outbox_restore
docker volume create master-hub_masterhub_redisdata_restore
```

2. アーカイブを各 volume に展開する

```powershell
docker run --rm `
  -v master-hub_masterhub_storage_restore:/restore `
  -v "C:\Backups\MasterHub\volumes:/backup" `
  alpine:3.20 sh -lc "tar -xzf /backup/volume_master-hub_masterhub_storage_YYYYMMDD_HHMMSS.tar.gz -C /restore"
```

3. `outbox` と `redisdata` も同様に展開する
4. 展開後にファイル一覧と総容量を確認する

## アプリ起動確認

1. 検証用 `.env.production` を用意する
2. 復元した DB と volume を向く構成で起動する
3. 次を確認する

- `GET /api/health?probe=ready` が 200
- 主要画面が開く
- 写真と帳票の参照ができる
- worker が異常終了しない

## 完了条件

- DB を復元できた
- 3 つの volume を展開できた
- `GET /api/health?probe=ready` が成功した
- 写真または帳票を 1 件以上開けた

## 毎回残すメモ

- 使用したバックアップ時刻
- 復元開始から readiness 成功までの所要時間
- 失敗した手順
- 次回までに直すこと