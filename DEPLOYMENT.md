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
> 本番は Vultr の Linux VPS(上の「推奨構成」)で、Docker Desktop/Windows は使わない。以下は Windows で自前運用する場合の前提。

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

# 作業表☆(原本)は会社PCの送信ツールから受け取る(本番の正式経路。下の「作業表☆の受け取り」参照)。
# 受け口のトークン(32文字以上のランダム文字列。リポジトリ・チャットに実値を書かない)
SHARED_SYNC_UPLOAD_TOKEN="<32文字以上のランダム文字列>"

# (任意・フォールバック) 共有フォルダをホストと同じマシンから直接読む場合のみ。
# 本番は Vultr(Linux)で会社の共有フォルダ(社内LANの Synology)に届かないため、通常は使わない。
# SHARED_SOURCE_HOST_PATH="/path/to/shared-folder"
# MASTER_HUB_SHARED_SOURCE_DIR="/shared-source"

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
- 作業表☆(原本)は、会社PCの送信ツールから `POST /api/sites/shared-sync/upload` で受け取り Redis に保存する(詳細は下の「作業表☆の受け取り」)。`SHARED_SYNC_UPLOAD_TOKEN` を設定しないと受け口は常に 503 で拒否する。共有フォルダをホストから直接読む方式(`SHARED_SOURCE_HOST_PATH`)は、共有フォルダが本番ホスト自身にある場合のフォールバック(未設定時はダミーの空フォルダがマウントされ、フォルダ側は「ファイル無し」扱いになるだけで起動は失敗しない)。受信済みの原本と共有フォルダのファイルが両方あるときは、更新日時が新しい方(同じなら受信分)を使う。
- 共有フォルダ同期(worker): 起動直後に1回、その後ファイル更新時刻に関わらず定期実行する。2系統に分かれている。
  - 週予定(`scope=schedule`): 作業表☆(原本)だけを読み、`SHARED_SYNC_SCHEDULE_INTERVAL_MS`（既定 300000 = 5分、最小 60000）ごとに週予定へ反映する。作業伝票ファイルが無くても動く。専用キュー(`shared-sync-schedule`)・専用ロックで、台帳同期の長時間処理に待たされない。原本が扱っている日付範囲を原本と完全一致させる差分同期(追加・更新・削除。変更のない予定は ID を保つ)。同じ人・日・現場の手入力の予定は原本の内容で上書きし、同じセルのそれ以外の手入力は残す。
  - 台帳・関係会社(`scope=ledger`): 作業伝票(アプリ内ブック)から `SHARED_SYNC_POLL_INTERVAL_MS`（既定 1800000 = 30分、最小 60000）ごと。ブック保存時は即時に反映する。ブックが正本のため共有フォルダ(作業表☆含む)には依存しない。ブックが未作成のときだけ共有フォルダの作業伝票ファイルを元データにする。
  - ふりがなの補完(現場・予定の摘要)は週予定の同期で行う。週予定に追加・更新・削除があったとき(画面の手動「全部」同期では常に)だけ実行する。
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

## 作業表☆の受け取り(会社PCから読み取り専用で送信)

本番は Vultr(東京)の Linux VPS で、会社の社内LAN(Synology の共有フォルダ)には届かない。そのため、原本(作業表☆)は**会社PCから本番へ送る**方式にしている。原本には一切書き込まない。

```mermaid
flowchart LR
  A[会社PC 送信ツール<br/>読み取り専用で原本を読む] -- HTTPS POST 変更時のみ --> B[web /api/sites/shared-sync/upload]
  B --> C[(Redis 受信済みの原本)]
  C --> D[worker 5分ごとに照合]
  D --> E[週予定 WorkEntry]
```

### 受け口(`/api/sites/shared-sync/upload`)の仕様

- 認証: `Authorization: Bearer <SHARED_SYNC_UPLOAD_TOKEN>`(32文字以上。未設定・短すぎる場合は常に 503 で拒否)。比較は定数時間。トークンはログ・レスポンスに出さない。
- `GET`: 送信ツールの生存確認。受信済みの原本の SHA-256 を返す(変更が無ければ送らない判断に使う)。呼ぶたびに「最終連絡」が更新される。
- `POST`: 原本の本体(バイナリ)。ヘッダ `x-file-name`(URL エンコード。`作業表☆` で始まる `.xlsx`/`.xls` のみ)、`x-source-mtime`(原本の更新日時 ms。年なし日付の年補完に使う)、`x-sha256`(任意。不一致は 400)。
- 制限: 最大 25MB(`SHARED_SYNC_UPLOAD_MAX_BYTES` で変更可)。中身が Excel(ZIP/OLE)でなければ 415。IP ごとに 120件/分、認証失敗は 10回/10分で 429。
- 保存先は Redis(最新1件・90日保持)。web と worker は別コンテナだが、どちらも Redis から取り出してコンテナ内の保存ディレクトリへ書き出すので共有ボリュームは不要。
- 画面の「原本を手動アップロード」(`/site-ledger/shared-upload`、週予定の編集権限が必要)は、同じ受け口を Cookie 認証で使う緊急用。
- worker は受信した原本に変化が無い間は同期を省く(1時間ごとの念のための再同期はする)。受信した原本と共有フォルダのファイルが両方あるときは、更新日時が新しい方(同じなら受信分)を使う。

### 本番サーバーの設定(1回だけ)

1. トークンを作る(本番ホストで。値は画面・チャット・リポジトリに貼らない): `openssl rand -base64 36`
2. 本番ホストの `.env.production` に `SHARED_SYNC_UPLOAD_TOKEN=<トークン>` を1行追記する。`deploy.yml` は再生成のたびに `SHARED_SYNC_` で始まる既存行を引き継ぐので、デプロイで消えない(`deploy.yml` は変更不要)。
3. `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate web worker`
4. HTTPS のリバースプロキシ(Cloudflare/Nginx 等)を使っている場合、リクエストボディの上限が 25MB 以上であること(Nginx は `client_max_body_size 30m;`。既定 1MB だと 413 になる)。送信は `https://` のみ(送信ツールは `http://` を拒否する)。

### 会社PCの設定(送信ツール)

前提: Windows PowerShell 5.1(標準)。管理者権限は不要。原本のある共有フォルダを、そのPCのログオンユーザーが読めること。

1. リポジトリ(または `scripts/shared-sync-agent.ps1` と `scripts/install-shared-sync-agent.ps1` の2ファイル)を会社PCへコピーする。
2. 次を実行する(`-SourceDir` は既定の `\\192.168.0.210\guest\共有フォルダ` と違うときだけ指定):
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-shared-sync-agent.ps1 -ServerUrl https://<本番のURL>`
3. トークンの入力を求められたら、画面に出ない入力欄へ直接貼る(DPAPI で暗号化して `%LOCALAPPDATA%\MasterHubAgent\token.dat` に保存。そのPCのそのユーザーだけが復号できる)。
4. タスクスケジューラに「MasterHub Shared Sync Agent」が登録される(ログオン時と5分おき。現在のユーザーで実行)。終了時にテスト実行され、終了コード 0 なら成功(1=エラー、2=原本が見つからない/読めない。詳細は `%LOCALAPPDATA%\MasterHubAgent\agent.log`)。
5. 削除: `scripts\install-shared-sync-agent.ps1 -Uninstall`(`-RemoveFiles` で保存先も削除)。トークンを変えるときは再実行して置き換える。

送信ツールの動き: 原本を読み取り専用(他のプログラムが開いたままでも読める共有モード)で開いてメモリへ読み込み、SHA-256 を計算 → 受け口の `GET` で受信済みの SHA-256 と比べ → 違うときだけ `POST`。ネットワークエラー・5xx・429 は 5/20/60秒で再試行、認証・検証エラー(4xx)は再試行しない。同時実行は1つだけ。ログは1MBで切り替え。

### 会社PCの停電・停止対策

原本を送れるのは、会社PCが起動しログオンしている間だけ。次を設定しておく。

- UPS(無停電電源)をつなぐ。
- BIOS/UEFI の「AC電源復帰時の動作(Restore on AC Power Loss / After Power Failure)」を「電源オン(Power On)」にする(停電復旧で自動起動)。
- スリープ・休止を無効にする(管理者のコマンドプロンプト): `powercfg /change standby-timeout-ac 0` / `powercfg /change hibernate-timeout-ac 0` / `powercfg /hibernate off`。高速スタートアップも無効にする(電源オプション → 電源ボタンの動作 → 高速スタートアップを無効)。ネットワークアダプターの「電力の節約のためにこのデバイスをオフにできる」のチェックを外す。
- 自動ログオン(送信タスクは「ログオン時」から動くため、再起動後にサインインが必要)。`netplwiz` か Sysinternals の Autologon で設定する。パスワードが端末に保存されるので、物理的に人が入れない場所のPCに限り、可能なら送信専用の権限の低いユーザーにする。
- Windows Update: アクティブ時間を 7:00〜20:00 にし、営業時間中に自動再起動しないようにする(再起動のあとも自動ログオンで復帰する)。
- 停止の検知: 稼働時間(日本時間 月〜土 7:00〜20:00)に45分以上、会社PCからの連絡も受信も無いと、現場台帳画面に「注意: 会社PCからの原本送信: ...」が出る。急ぎのときは「原本を手動アップロード」を使う。

### アプリ側の編集の保護(要点)

- 原本の同期は一方向だが、アプリで手入力・編集・削除した予定は同期で上書き・削除されない(編集した行には印が付く)。
- アプリで削除した原本由来の予定は、原本に残っていても再作成されない(削除記録 = 墓標。`UserUiSetting` のグローバル設定 `shared-sync:{normal|daily}:tombstones` に保存。保持期間 400 日は未承認の暫定値)。
- 制限: 原本側が、アプリで編集済みの予定の内容を後から変えると、新しい内容の予定が別行として追加される(編集済みの行は自動では消えない)。

### 提案(未適用・承認後に実施)

- `deploy.yml` でのトークン保持: 現状は本番ホストの `.env.production` に一度書けば引き継がれる(上記)。ホストを作り直しても復元できるようにするなら、GitHub Secrets に `PROD_SHARED_SYNC_UPLOAD_TOKEN` を登録し、`deploy.yml` の `env:` / `envs:` に追加して `append_env_if_set SHARED_SYNC_UPLOAD_TOKEN "${SHARED_SYNC_UPLOAD_TOKEN:-}"` を書く(Settings → Secrets and variables → Actions → New repository secret)。
- Docker ビルドキャッシュの掃除(ディスク逼迫対策): 週1回の cron で `docker builder prune -af --filter until=168h` と `docker image prune -f` を実行する(実行中のコンテナ・ボリュームには影響しない)。
- マイグレーション: この機能で必要な DB 変更は無い(Redis と既存の `UserUiSetting` のみ使用)。

## 同期の確認

共有フォルダ同期(worker)が本番ホストで動いているかを確認する手順。本番は Vultr の Linux VPS なので、SSH で入って bash で `DEPLOY_PATH` のリポジトリ直下から実行する(Docker Desktop や PowerShell は使わない。手順中の PowerShell 表記は旧構成の名残で、Linux では下の bash 版に読み替える)。以降の `$c` は次の別名として使う。

```bash
c="compose -f docker-compose.prod.yml --env-file .env.production"   # 使い方: docker $c ps
```

原本を会社PCの送信ツールから受け取っている場合(本番の標準)、確認の中心は「現場台帳画面の同期ステータス行(会社PCからの原本送信の最終受信/最終連絡)」と worker ログです。

### 確認手順(7ステップ)

1. コンテナが全部 Up か: `docker $c ps` — `redis` / `web` が `healthy`、`worker` が `Up` であること(`Restarting` / `Exited` は異常)。
2. worker のログに同期の行があるか: `docker $c logs --tail=200 worker | grep shared-sync`
   - 起動時に `poller started: scope=schedule intervalMs=300000` と `scope=ledger intervalMs=1800000` が出ている
   - 原本に変化がある間は直近5分以内に `enqueued: scope=schedule kind=NORMAL` と `success: scope=schedule kind=NORMAL durationMs=... counts={...}` がある(台帳は30分以内)。会社PCから受信した原本に変化が無い間は同期を省くため `enqueued` は出ず、1時間ごとの念のための再同期だけがログに出る(画面の同期ステータスは「正常」のまま)
   - `failed` / `skip` / `tick failed` / `skipped (busy)` が続いていない(下の表を参照)
3. 原本を受信しているか: 現場台帳画面の「会社PCからの原本送信」行で最終受信/最終連絡が新しいこと。共有フォルダを直接読むフォールバックを使っている場合のみ: `docker $c exec worker ls /shared-source` で `作業表☆.xlsx` が見えること(空・`No such file or directory` なら `SHARED_SOURCE_HOST_PATH` が誤り)。
4. 環境変数が入っているか: `docker $c exec worker sh -c "printenv | grep -E 'SHARED_SYNC|MASTER_HUB'"` — worker と web の両方で `SHARED_SYNC_UPLOAD_TOKEN` が存在し、`MASTER_HUB_STORAGE_DIR` があること(値はチャット等に貼らない)。ホスト側は `grep -c SHARED_SYNC_UPLOAD_TOKEN .env.production`(1 以上)で確認する。
5. Redis が生きているか: `docker $c exec redis redis-cli ping` — `PONG`。
6. 現場台帳画面(編集権限者)の同期ステータス行: 「週予定の同期(5分おき)」の最終成功が5分前後以内で、「注意: ...が止まっている可能性」の行が出ていないこと(警告は最終成功が15分を超えた時点から出る)。
7. 修正が本番に届いているか: push 済み(`git log origin/main -n 5` に目的のコミットがある)かつ配備済み(GitHub Actions の `Deploy to Production` が成功、本番ホストで `git log -n 1` が同じコミット)。push するだけで自動配備される。

### よくある失敗

| ログ・画面の表示 | 原因 | 対処 |
| --- | --- | --- |
| `skip: ... sources not found ... 作業表☆がありません(会社PCからの送信を受信していません)` / 画面「会社PCからの連絡が N 分間ありません」 | 会社PCの送信ツールが動いていない(PC停止・スリープ・ログオフ・ネットワーク・トークン不一致) | 会社PCの `%LOCALAPPDATA%\MasterHubAgent\agent.log` を確認。急ぎなら「原本を手動アップロード」を使う |
| `skip: ... sources not found dir=/shared-source 共有フォルダにアクセスできません: ... (ENOENT)` | (フォルダ直読みのフォールバックを使う場合のみ) `SHARED_SOURCE_HOST_PATH` のパスが存在しない/誤り(bind mount 失敗)。本番で原本を受信済みならこの行は出ても無視してよい | 受信済みの原本があれば同期は受信分で動く。フォルダ直読みを使うなら `.env.production` のパスを直して `docker $c up -d` で worker を再作成 |
| `skip: ... sources not found ... workTable=- workSlip=-` | 共有フォルダは見えるが `作業表☆.xlsx` が無い(`SHARED_SOURCE_HOST_PATH` 未設定時の空ダミーも同じ表示) | 共有フォルダに原本を置く / パスを設定する |
| `failed: scope=schedule ... error=必要な元データがありません: ...` | 手動同期など、元データが無い状態で実行された | 共有フォルダとファイル名を確認 |
| `failed: ... error=Excel 読み取りに失敗: ...` | 原本が壊れている/保存途中/パスワード保護 | ファイルを開き直して保存し直す(次の周期で自動再試行) |
| `skip enqueue: ... previous job still pending` が連続 | 前回のジョブが終わらない(DB遅延・worker 停止) | `failed` の行と DB 接続を確認し、`docker $c restart worker` |
| `skipped (busy): ...` が連続 | 手動同期やブック保存の反映と周期同期が競合 | 一時的なら無視。連続するなら手動同期の実行中でないか確認 |
| `tick failed: ... error=...` | Redis 未接続・キュー操作の失敗 | `redis-cli ping` と `REDIS_URL` を確認 |
| ログに `poller started` が無い/worker が再起動を繰り返す | `SHARED_SYNC_POLL_ENABLED=0`、`NODE_ENV` 不一致、起動時エラー | `docker $c logs worker` の先頭を確認し、`SHARED_SYNC_POLL_ENABLED` を確認 |
| デプロイ後に共有フォルダ系の設定が消えた | `.env.production` の再生成で `SHARED_SOURCE_HOST_PATH` 等が落ちた(`deploy.yml` は既存行を引き継ぐが、手で作り直した場合は消える) | `.env.production` に `SHARED_SOURCE_HOST_PATH` / `MASTER_HUB_SHARED_SOURCE_DIR` を再設定して `up -d` |
| ブック保存が台帳に反映されない | 台帳はブックが正本で共有フォルダに依存しない。反映失敗は同期ステータス(台帳)に `failed` / `skipped` として残る | 現場台帳画面の「台帳・関係会社の反映」の結果と worker/web ログを確認 |

### (旧構成・参考)フォルダ直読みの設定が消えたときの復旧コマンド(Windows の Docker Desktop ホスト・リポジトリ直下)

> 本番(Vultr Linux)は共有フォルダを直接読まないため、この節と次の2節(IP 確認・CIFS)は「共有フォルダと同じネットワーク上の Windows ホストでアプリを動かす場合」の参考です。Vultr では上の「作業表☆の受け取り」を使います。

「同期の確認」のステップ3/4で `/shared-source` が空・環境変数が無い場合の復旧。`$c` は上の別名と同じ。`.env.production` 以外は触らない。

```powershell
$c = @('compose','-f','docker-compose.prod.yml','--env-file','.env.production')

# 1) 現状(共有フォルダ関係の行だけ)
Select-String -Path .env.production -Pattern 'SHARED_SOURCE_HOST_PATH|MASTER_HUB_SHARED_SOURCE_DIR|SHARED_SYNC_'

# 2) 2行を入れ直す(既存の同名行を消してから追記。BOM なしで保存)
$hostPath = 'C:/path/to/共有フォルダ'   # 本番PCから見た共有フォルダの実パス(スラッシュ区切り)
$keep = Get-Content .env.production | Where-Object { $_ -notmatch '^(SHARED_SOURCE_HOST_PATH|MASTER_HUB_SHARED_SOURCE_DIR)=' }
$keep += "SHARED_SOURCE_HOST_PATH=$hostPath"
$keep += 'MASTER_HUB_SHARED_SOURCE_DIR=/shared-source'
[System.IO.File]::WriteAllLines((Join-Path (Get-Location) '.env.production'), $keep, (New-Object System.Text.UTF8Encoding($false)))

# 3) worker / web を作り直す(環境変数・マウントの変更を反映)
docker $c up -d --force-recreate worker web

# 4) 確認(作業表☆.xlsx が見える / 環境変数が入っている)
docker $c exec worker ls /shared-source
docker $c exec worker sh -c "printenv | grep -E 'MASTER_HUB_SHARED_SOURCE_DIR'"
docker $c logs --tail=50 worker | Select-String shared-sync
```

その後、現場台帳画面の同期ステータス行で、週予定の最終成功が数分以内に更新されることを確認する。`MASTER_HUB_SHARED_SOURCE_DIR` を書かないと、worker は既定の `\\192.168.0.210\guest\共有フォルダ`(コンテナ内では開けない)を読みに行き、`ENOENT` で同期できない(worker は起動時にこの状態を1回だけ警告する)。

### (旧構成・参考)本番PCのIPアドレスの確認と、共有フォルダのホストかどうか

Windows ホスト(Docker Desktop のPC)でアプリを動かす場合の PowerShell:

```powershell
# このPCのIPv4(社内LAN)
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object InterfaceAlias, IPAddress

# 共有フォルダのホストが「このPC」か: ローカルで共有している名前と実パス
Get-SmbShare | Select-Object Name, Path

# 別PC(例: 192.168.0.210)の共有を、このPCから読めるか
Test-Path '\\192.168.0.210\guest\共有フォルダ'
```

- `192.168.0.210` が上のIPに含まれ、`Get-SmbShare` に共有フォルダの実パスが出る → このPCがホスト。`SHARED_SOURCE_HOST_PATH` にその実パス(スラッシュ区切り)を書けばよい(上の復旧コマンド)。
- IPに含まれない → 共有フォルダは別PC。ホストの実パスは使えないので、次の案が必要。

### (旧計画・本番 Vultr では使えない)共有フォルダが別PCにある場合(CIFS)

> Vultr は社内LAN(192.168.x.x)の Synology へ届かないため、本番ではこの方式を使わない(コード・`deploy.yml` の分岐はフォールバックとして残しているだけ)。以下は Windows ホスト向けの旧記述。

本番PCが共有フォルダのホストでないとき、`/shared-source` に SMB 共有を直接マウントする。`docker-compose.shared-cifs.yml`(上書きファイル)を使い、`deploy.yml` は本番PCの `.env.host` に `SHARED_CIFS_HOST` があるときだけ `-f docker-compose.shared-cifs.yml` を追加して読み込む(無ければ従来どおり `SHARED_SOURCE_HOST_PATH` の bind mount)。

- 本番PCのデプロイ先(`DEPLOY_PATH`)に `.env.host` を作り、次の4行を書く(読み取り専用アカウント。リポジトリ・GitHub・compose には実値を書かない。`.env.host` は再生成されない):
  `SHARED_CIFS_HOST=192.168.0.210` / `SHARED_CIFS_PATH=guest/共有フォルダ` / `SHARED_CIFS_USER=...` / `SHARED_CIFS_PASSWORD=...`
- 手動で起動・確認するとき(`$c` を差し替える): `$c = @('compose','-f','docker-compose.prod.yml','-f','docker-compose.shared-cifs.yml','--env-file','.env.production','--env-file','.env.host')`
- Docker Desktop(WSL2)では未検証。適用後に `docker $c exec worker ls /shared-source` で `作業表☆.xlsx` が見えることを必ず確認する。
- 代替: 共有元PC側で本番PCへ同期(robocopy など)して、本番PCのローカルフォルダを `SHARED_SOURCE_HOST_PATH` に指定する。認証情報をコンテナに渡さずに済む。

### 設定消去の対策(適用済み・本番反映は push 後・フォルダ直読みのフォールバック用)

`deploy.yml` は `.env.production` を毎回再生成する。今は次のとおり、再生成されても消えない:

- `MASTER_HUB_SHARED_SOURCE_DIR=/shared-source` は常に書く(コンテナ内の固定パス。設定が無くても既定の `\\...` を読みに行かない)。
- `SHARED_SOURCE_HOST_PATH` は、GitHub の Variables `PROD_SHARED_SOURCE_HOST_PATH` があればそれを書き、無ければ既存の行を引き継ぐ(`SHARED_SYNC_*` も引き継ぐ)。
- ホスト固有の値は `.env.host`(リポジトリ外)にも置ける。`.env.host` があれば `--env-file .env.production --env-file .env.host` で読む(変数展開用。`SHARED_SOURCE_HOST_PATH` や CIFS の値)。

本番の復旧は、GitHub の Settings → Secrets and variables → Actions → Variables に `PROD_SHARED_SOURCE_HOST_PATH`(本番PCから見た共有フォルダの実パス、スラッシュ区切り)を登録して、デプロイ(`workflow_dispatch` でも可)を1回実行するだけでよい。
### 印のない旧予定とタイムゾーン

- 印のない旧予定(`sharedExcelSync` の印が付く前に作られた予定): 手入力と区別できないため、同期は消さない。同じ人・日・現場(または同じ文字)のものは原本で上書きされて同期由来になる。文言も違う場合だけ残り、画面に二重表示される。案(未適用): 承認済みの一括整理(`scripts/ledger-requote.ts` と同様の dry-run → 承認ID指定の削除)を別途用意する。
- タイムゾーン: 同期由来の予定は日付の UTC 12:00 で保存するので、UTC のコンテナでも日本時間のPCでも日付はずれない(UTC-11〜+11 の範囲で同じ日)。ずれる可能性があるのは、日本時間の 0:00 付近で作られた手入力の予定を UTC のコンテナが読む場合(前日扱い)で、同じ人・日・現場の上書き判定を外すことがある。対策(適用済み・本番反映は push 後): `docker-compose.prod.yml` の `web` / `worker` に `TZ=Asia/Tokyo` を設定した。

### 停止の自動検知(画面警告)

- worker は周期ごとの結果(`enqueued` / `no-sources` / `previous-pending` / `error`)を Redis のキー `masterhub:shared-sync:poller:{scope}:{kind}` に記録する(心拍)。
- 現場台帳画面(編集権限者のみ)は、最終成功が 週予定 15分 / 台帳 90分 を超えた場合に、理由(ポーラーの記録が無い・古い / 同期元なし / 滞留 / 直近の失敗)つきで「注意: ... が止まっている可能性」を表示する。成功が新しい間は警告しない。しきい値は `src/shared/shared-sync-health.ts` の定数(`SCHEDULE_STALE_MS` / `LEDGER_STALE_MS`)。
- 同じ情報は `GET /api/sites/shared-sync`(`status` / `poller` / `health` / `upload`)でも取得できる。
- 理由 `unchanged`: 会社PCから受信した原本に変化が無いため同期を省いた状態。最後の成功が1時間定期の再同期の範囲(約1時間半以内)なら「正常」扱いで警告しない。
- 会社PCの送信ツールの停止: 日本時間 月〜土 7:00〜20:00 に連絡(GET/POST)も受信も 45分以上無いと警告する(定数は `src/shared/shared-sync-upload.ts` の `AGENT_SILENT_MS`、`src/shared/shared-sync-health.ts` の `UNCHANGED_*`)。トークン未設定のときは「作業表☆の入手手段が未設定」の設定警告を出す。

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
