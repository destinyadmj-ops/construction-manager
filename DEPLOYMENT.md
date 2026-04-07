# 会社持ち込み用デプロイメントガイド

作成日: 2026年1月10日  
バージョン: checkpoint-20260110

## 概要

このドキュメントは Master Hub を会社環境にデプロイするための手順書です。

## 推奨構成

### 最小コストで始めるなら

- DB: Supabase Postgres
- アプリ配置: 小さな Linux VPS 1 台
- Web / Worker: VPS 上の Docker Compose
- Redis: 同じ Docker Compose 内の Redis コンテナ
- ファイル保存: 同じ VPS 上の Docker ボリューム
- DNS / HTTPS / WAF: 必要なら Cloudflare

この構成を推奨する理由:

- 現在のリポジトリは Prisma + Postgres + BullMQ + 別 worker 前提で、最小変更でそのまま載せられる
- `docker-compose.prod.yml` と `deploy.yml` がそのまま使える
- Redis を同居させれば、初期段階では managed Redis を別契約しなくてよい
- Cloudflare は前段には有効だが、アプリ本体や worker の実行先そのものにはしない方が現実的

推奨スペックの目安:

- 2 vCPU / 2 GB RAM / 40 GB SSD 以上
- Ubuntu 24.04 LTS などの Linux
- Docker / Docker Compose / Git / SSH を利用可能にする

## 前提条件

### 必須環境
- Windows Server または Windows 10/11
- Docker Desktop for Windows（WSL2バックエンド推奨）
- Node.js 18.x 以上
- PostgreSQL（Azure Database for PostgreSQL または Docker）
- Redis（Azure Cache for Redis または Docker）

### 推奨環境
- メモリ: 8GB以上
- ストレージ: 50GB以上の空き容量
- ネットワーク: 社内LAN接続

## デプロイ方法

### 方法1: Docker Compose（推奨）

最も簡単で確実な方法です。

#### 1. リポジトリのクローン

```powershell
git clone <リポジトリURL>
cd master-hub
```

#### 2. 環境変数の設定

`.env.production.example` をコピーして `.env.production` を作成：

```powershell
Copy-Item .env.production.example .env.production
```

`.env.production` を編集して以下を設定：

```env
# データベース（Supabase Session Pooler / Direct connection）
DATABASE_URL="postgresql://postgres.PROJECT_REF:YOUR_DB_PASSWORD@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
DIRECT_URL="postgresql://postgres:YOUR_DB_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require"

# Redis（同居 Redis を使う最小構成）
REDIS_URL="redis://redis:6379"

# ファイル保存（同居ボリューム）
MASTER_HUB_STORAGE_DIR="/data/masterhub-storage"
PRINT_OUTBOX_DIR="/data/masterhub-outbox/print"
FAX_OUTBOX_DIR="/data/masterhub-outbox/fax"

# 認証（任意の強力なパスワードを設定）
NEXTAUTH_SECRET="<ランダムな文字列>"

# アプリケーションURL
NEXTAUTH_URL="https://your-domain.com"

# 管理API保護（任意だが本番では推奨）
ADMIN_TOKEN="<ランダムな文字列>"
```

#### 3. Docker イメージのビルドと起動

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

補足:

- `docker-compose.prod.yml` は `web` / `worker` に加えて `redis` も起動する
- `masterhub_storage` ボリュームに写真・帳票の保存先を載せる
- `masterhub_outbox` ボリュームに印刷/FAX 出力ファイルを載せる
- まずは 1 台構成で十分で、Redis を外出しするのは負荷や可用性要件が出てからでよい

#### 4. 動作確認

ブラウザで `http://localhost:3000` にアクセス

#### 5. 停止

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.production down
```

### 方法1-補足: GitHub Actions から SSH で自動配備

- 本番サーバーに Docker / Docker Compose / Git が入っていること
- GitHub Actions ランナーから SSH 到達できること
- repository secrets は次の区分で設定すること

本番 deploy に必須:

```text
SUPABASE_DATABASE_URL
SUPABASE_DIRECT_URL
PROD_NEXTAUTH_SECRET
PROD_NEXTAUTH_URL
DEPLOY_HOST
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_PATH
```

本番 deploy で任意:

```text
PROD_REDIS_URL
PROD_ADMIN_TOKEN
```

Prisma 関連 workflow 用:

```text
SUPABASE_DATABASE_URL
SUPABASE_DIRECT_URL
```

Play 配布 workflow 用:

```text
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
PACKAGE_NAME
```

- `SUPABASE_DATABASE_URL` は Supabase の Session pooler 接続文字列
- `SUPABASE_DIRECT_URL` は Supabase の Direct connection 接続文字列
- `PROD_REDIS_URL` 未設定時は `redis://redis:6379` を使い、同じ Docker Compose の Redis コンテナへ接続する
- `PROD_ADMIN_TOKEN` 未設定でも deploy 自体は通るが、管理 API を使うなら本番では設定推奨
- `MASTER_HUB_STORAGE_DIR` / `PRINT_OUTBOX_DIR` / `FAX_OUTBOX_DIR` は secret 化せず、deploy workflow が `/data/masterhub-storage` と `/data/masterhub-outbox/*` を既定値として書き込む
- `DEPLOY_PATH` はサーバー上でリポジトリを展開する絶対パス
- `Check Prisma Migrations` は `SUPABASE_DIRECT_URL` 未設定時に `SUPABASE_DATABASE_URL` へフォールバックする
- `deploy.yml` は SSH 接続後に `.env.production` を生成し、`docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build --remove-orphans` を実行する

### 方法2: Windows Service（永続運用）

Docker を使わずに Windows サービスとして常時稼働させる方法です。

#### 1. 依存関係のインストール

```powershell
npm install
```

#### 2. Prisma の準備

```powershell
npm run db:generate
npm run db:migrate
```

#### 3. プロダクションビルド

```powershell
npm run build
```

#### 4. PM2 のインストール（プロセス管理）

```powershell
npm install -g pm2
npm install -g pm2-windows-service
```

#### 5. PM2 サービスのインストール

```powershell
pm2-service-install
```

#### 6. アプリケーションの登録

```powershell
# Web サーバー
pm2 start npm --name "master-hub-web" -- run start -- -H 0.0.0.0 -p 3000

# Worker
pm2 start npm --name "master-hub-worker" -- run worker

# 保存
pm2 save
```

#### 7. 自動起動の確認

```powershell
pm2 list
```

### 方法3: Synology NAS（Container Manager）

Synology NAS がある場合の手順です。

詳細は [deploy/synology/README.md](deploy/synology/README.md) を参照してください。

## データベースのセットアップ

### Azure Database for PostgreSQL を使う場合

1. Azure Portal で PostgreSQL サーバーを作成
2. データベース `master_hub` を作成
3. ファイアウォール規則で接続元IPを許可
4. 接続文字列を `.env.production` に設定

### Docker で PostgreSQL を使う場合

```powershell
npm run docker:up
```

接続文字列（例）：
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/master_hub"
```

## セキュリティ

### 認証設定

デフォルトでは簡易認証が有効です。初回ユーザー登録で管理者アカウントを作成してください。

### HTTPS の設定

本番環境では必ず HTTPS を使用してください。

#### リバースプロキシ（IIS/Nginx）を使う方法

1. IIS または Nginx をインストール
2. SSL証明書を取得（Let's Encrypt など）
3. リバースプロキシ設定で `http://localhost:3000` を転送

#### mkcert を使う方法（開発/テスト用）

```powershell
# mkcert のインストール
winget install FiloSottile.mkcert

# 証明書の生成
npm run mkcert:lan

# HTTPS で起動
npm run prod:https
```

## バックアップ

### データベースのバックアップ

自動バックアップ（1時間ごと）の設定手順は [scripts/backup/README.md](scripts/backup/README.md) を参照してください。

### 手動バックアップ

```powershell
# データベースダンプ
pg_dump -U postgres -d master_hub > backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql
```

## トラブルシューティング

### ポート競合

```powershell
# ポート確認
npm run dev:port:who

# ポート強制解放
npm run dev:kill:port -- -Port 3000 -Force
```

### Docker イメージの再ビルド

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.production down
docker compose -f docker-compose.prod.yml --env-file .env.production build --no-cache
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

### ログの確認

```powershell
# Docker ログ
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f

# アプリケーションログ
npm run dev:logs:tail
```

## アップデート手順

1. 最新コードの取得

```powershell
git pull
```

2. 依存関係の更新

```powershell
npm install
```

3. データベースマイグレーション

```powershell
npm run db:migrate
```

4. 再ビルドと再起動

```powershell
npm run build
# Docker の場合
docker compose -f docker-compose.prod.yml --env-file .env.production restart

# PM2 の場合
pm2 restart all
```

## モニタリング

### ヘルスチェック

```powershell
# Web サーバー
curl http://localhost:3000/api/health

# レスポンス例: {"ok":true}
```

### PM2 モニタリング

```powershell
pm2 monit
```

### Docker モニタリング

```powershell
docker stats
```

## サポート

問題が発生した場合は、以下の情報を添えて報告してください：

- エラーメッセージ
- ログファイル（`dev-keep.log`）
- 環境情報（OS、Node.jsバージョン、Dockerバージョン）
- 実行したコマンド

## チェックリスト

デプロイ前の確認項目：

- [ ] PostgreSQL が起動している
- [ ] Redis が起動している
- [ ] `.env.production` が設定されている
- [ ] `NEXTAUTH_SECRET` が設定されている
- [ ] データベースマイグレーションが完了している
- [ ] プロダクションビルドが成功している
- [ ] ヘルスチェックが通る
- [ ] HTTPSが設定されている（本番環境）
- [ ] バックアップ設定が完了している

## 変更履歴

### 2026-01-10
- セル直接入力機能追加（DB連携の予測入力）
- ファイル取り込み機能追加（関係会社）
- 複数会社一括取り込み機能追加
- アラートボタン追加と未読数バッジ表示
- アラートボタンのデザイン・配置変更

---

最終更新: 2026年1月10日  
Git タグ: checkpoint-20260110  
Git コミット: 13de567
