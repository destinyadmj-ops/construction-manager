# Prisma migrations

このフォルダは Prisma のマイグレーション履歴です。

## 20251226105607_cd_c_users_... について

- `20251226105607_cd_c_users_desti_master_hub_master_hub_npm_run_db_migrate` は、`prisma migrate dev` 実行時の「migration name」入力で意図せずフルパス文字列が入ってしまい、フォルダ名が長くなったものです。
- 中身は `updatedAt` の `DEFAULT` を外す等、スキーマ整合のための軽微な変更です。
- **DBに適用済みのマイグレーションは削除/改名しないでください**（他環境で整合が取れなくなります）。

## 事故防止（推奨）

- `npm run db:migrate` は `scripts/db-migrate.ps1` 経由で名前を検証します（誤入力で長いフォルダ名が作られるのを防止）。
- 直接 Prisma を叩きたい場合は `npm run db:migrate:raw` を使ってください。
