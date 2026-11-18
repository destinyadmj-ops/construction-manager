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

# 共有フォルダ(作業表☆/作業伝票)自動同期用。
# 本番を動かす Docker Desktop のPCが共有フォルダのホストPCと同一の場合、
# ネットワーク越しのCIFSマウントは不要。ホスト側ローカルパスを bind mount で直接コンテナへ渡す。
SHARED_SOURCE_HOST_PATH="C:/path/to/共有フォルダ"
MASTER_HUB_SHARED_SOURCE_DIR="/shared-source"

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
- 共有フォルダ(作業表☆/作業伝票)自動同期を使う場合、本番ホスト上で共有フォルダが置かれているローカルパスを `SHARED_SOURCE_HOST_PATH` に設定する（未設定時はダミーの空フォルダがマウントされ同期は「ファイル無し」扱いになるだけで起動は失敗しない）。共有フォルダがこの本番PC自体でホストされている前提のため、別PC/NAS宛のネットワーク越しマウント設定は不要。
- 共有フォルダ同期(worker): 起動直後に1回、その後ファイル更新時刻に関わらず定期実行する。2系統に分かれている。
  - 週予定(`scope=schedule`): 作業表☆(原本)だけを読み、`SHARED_SYNC_SCHEDULE_INTERVAL_MS`（既定 300000 = 5分、最小 60000）ごとに週予定へ反映する。作業伝票ファイルが無くても動く。専用キュー(`shared-sync-schedule`)・専用ロックで、台帳同期の長時間処理に待たされない。原本が扱っている日付範囲を原本と完全一致させる差分同期(追加・更新・削除。変更のない予定は ID を保つ)。同じ人・日・現場の手入力の予定は原本の内容で上書きし、同じセルのそれ以外の手入力は残す。
  - 台帳・関係会社(`scope=ledger`): 作業伝票(アプリ内ブック)から `SHARED_SYNC_POLL_INTERVAL_MS`（既定 1800000 = 30分、最小 60000）ごと。ブック保存時は即時に反映する。
  再実行は冪等で、失敗しても次回に再試行する。画面の「共有フォルダ同期」(`/api/sites/shared-sync`)との同時実行は同じ系統のみ排他され、実行中なら 409 を返す。最終同期の時刻・結果・件数は現場台帳画面（編集権限者のみ）に表示される。
- `SHARED_SYNC_POLL_ENABLED`: `1` で強制有効 / `0` で無効。未設定時は `NODE_ENV=production`（本番の worker コンテナ）のみ有効で、開発PCの `npm run worker` は実DBへ同期しない。
- 同期を実行する worker は本番ホスト上の1台のみにする（本番とローカルPCの両方で動かすと、別々の Redis の下で二重に同期が走る）。
- いつ同期されたかは worker のログで確認する: `docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=200 worker | findstr shared-sync`（`poller started` / `enqueued` / `success`(counts と所要時間) / `failed` / `skip`(共有フォルダにファイルが無い) の各行）。
- `.env.production` は GitHub Actions のデプロイで再生成されるが、`DESKTOP_APP_*` と同様に `SHARED_SOURCE_HOST_PATH` / `MASTER_HUB_SHARED_SOURCE_DIR` / `SHARED_SYNC_*` の行はホスト側の既存値が引き継がれる。

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

## 同期の確認

共有フォルダ同期(worker)が本番ホストで動いているかを確認する手順。本番ホスト(Docker Desktop のPC)の PowerShell で、`DEPLOY_PATH` のリポジトリ直下から実行する。以降の `$c` は次の別名として使う。

```powershell
$c = @('compose','-f','docker-compose.prod.yml','--env-file','.env.production')
```

### 確認手順(7ステップ)

1. コンテナが全部 Up か: `docker $c ps` — `redis` / `web` が `healthy`、`worker` が `Up` であること(`Restarting` / `Exited` は異常)。
2. worker のログに同期の行があるか: `docker $c logs --tail=200 worker | Select-String shared-sync`
   - 起動時に `poller started: scope=schedule intervalMs=300000` と `scope=ledger intervalMs=1800000` が出ている
   - 直近5分以内に `enqueued: scope=schedule kind=NORMAL` と `success: scope=schedule kind=NORMAL durationMs=... counts={...}` がある(台帳は30分以内)
   - `failed` / `skip` / `tick failed` / `skipped (busy)` が続いていない(下の表を参照)
3. 共有フォルダが worker から見えているか: `docker $c exec worker ls /shared-source` — `作業表☆.xlsx` が見えること。空・`No such file or directory` なら `SHARED_SOURCE_HOST_PATH` が誤り。
4. 環境変数が入っているか: `docker $c exec worker sh -c "printenv | grep -E 'SHARED|MASTER_HUB'"` — `MASTER_HUB_SHARED_SOURCE_DIR=/shared-source` と `MASTER_HUB_STORAGE_DIR` があること。`SHARED_SOURCE_HOST_PATH` は compose 側(ホスト)の値なので、コンテナ内には出ない場合がある。ホスト側は `Select-String -Path .env.production -Pattern 'SHARED'` で確認する。
5. Redis が生きているか: `docker $c exec redis redis-cli ping` — `PONG`。
6. 現場台帳画面(編集権限者)の同期ステータス行: 「週予定の同期(5分おき)」の最終成功が5分以内(目安: 最大でも10分)で、「注意: ...が止まっている可能性」の赤/黄の行が出ていないこと。
7. 修正が本番に届いているか: push 済み(`git log origin/main -n 5` に目的のコミットがある)かつ配備済み(GitHub Actions の `Deploy to Production` が成功、本番ホストで `git log -n 1` が同じコミット)。push するだけで自動配備される。

### よくある失敗

| ログ・画面の表示 | 原因 | 対処 |
| --- | --- | --- |
| `skip: ... sources not found dir=/shared-source 共有フォルダにアクセスできません: ... (ENOENT)` | `SHARED_SOURCE_HOST_PATH` のパスが存在しない/誤り(bind mount 失敗) | `.env.production` のパスを直して `docker $c up -d` で worker を再作成 |
| `skip: ... sources not found ... workTable=- workSlip=-` | 共有フォルダは見えるが `作業表☆.xlsx` が無い(`SHARED_SOURCE_HOST_PATH` 未設定時の空ダミーも同じ表示) | 共有フォルダに原本を置く / パスを設定する |
| `failed: scope=schedule ... error=必要な元データがありません: ...` | 手動同期など、元データが無い状態で実行された | 共有フォルダとファイル名を確認 |
| `failed: ... error=Excel 読み取りに失敗: ...` | 原本が壊れている/保存途中/パスワード保護 | ファイルを開き直して保存し直す(次の周期で自動再試行) |
| `skip enqueue: ... previous job still pending` が連続 | 前回のジョブが終わらない(DB遅延・worker 停止) | `failed` の行と DB 接続を確認し、`docker $c restart worker` |
| `skipped (busy): ...` が連続 | 手動同期やブック保存の反映と周期同期が競合 | 一時的なら無視。連続するなら手動同期の実行中でないか確認 |
| `tick failed: ... error=...` | Redis 未接続・キュー操作の失敗 | `redis-cli ping` と `REDIS_URL` を確認 |
| ログに `poller started` が無い/worker が再起動を繰り返す | `SHARED_SYNC_POLL_ENABLED=0`、`NODE_ENV` 不一致、起動時エラー | `docker $c logs worker` の先頭を確認し、`SHARED_SYNC_POLL_ENABLED` を確認 |
| デプロイ後に共有フォルダ系の設定が消えた | `.env.production` の再生成で `SHARED_SOURCE_HOST_PATH` 等が落ちた(`deploy.yml` は既存行を引き継ぐが、手で作り直した場合は消える) | `.env.production` に `SHARED_SOURCE_HOST_PATH` / `MASTER_HUB_SHARED_SOURCE_DIR` を再設定して `up -d` |
| ブック保存が台帳に反映されない | 台帳はブックが正本で共有フォルダに依存しない。反映失敗は同期ステータス(台帳)に `failed` / `skipped` として残る | 現場台帳画面の「台帳・関係会社の反映」の結果と worker/web ログを確認 |

### 停止の自動検知(画面警告)

- worker は周期ごとの結果(`enqueued` / `no-sources` / `previous-pending` / `error`)を Redis のキー `masterhub:shared-sync:poller:{scope}:{kind}` に記録する(心拍)。
- 現場台帳画面(編集権限者のみ)は、最終成功が 週予定 15分 / 台帳 90分 を超える、またはポーラーの記録が古い・無い場合に「注意: ... が止まっている可能性」と理由を表示する。しきい値は `src/shared/shared-sync-health.ts` の定数(`SCHEDULE_STALE_MS` / `LEDGER_STALE_MS`)。
- 同じ情報は `GET /api/sites/shared-sync`(`status` / `poller` / `health`)でも取得できる。

### worker ヘルスチェックの提案(未適用)

`docker-compose.prod.yml` は変更していない。承認後に適用する案:

- `worker` に `healthcheck` を追加し、Redis の心拍キーが一定時間内に更新されているかを `node -e` で確認する(例: `masterhub:shared-sync:poller:schedule:NORMAL` の `at` が15分以内なら 0、超過なら 1)。
- 影響: (1) 共有フォルダが無い・空の間も心拍は更新されるので `healthy` のまま(= 「worker が生きている」の判定であり、「同期が成功している」の判定ではない)。(2) `docker compose up -d` は `service_healthy` を待つのは `depends_on` を書いた側だけなので、`deploy.yml` の `check_ready`(web の `/api/health?probe=ready` のみ)は変えなくても動く。worker を `unhealthy` で自動再起動することはない(`restart: unless-stopped` は unhealthy では再起動しない)ので、検知用の表示(`docker ps`)に留まる。(3) 自動再起動まで行うなら別途 autoheal 相当が必要で、今回は対象外。
- 起動直後(初回 tick 前)は `start_period` を長め(例: 60s)にして誤検知を避ける。

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
