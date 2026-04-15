
# Master Hub

---
## 会社・自宅で同じDBを使う推奨構成

このプロジェクトを会社・自宅など複数拠点で運用する場合は、コードは GitHub、DB は Supabase、Redis は各PCローカル起動を基本構成にします。

### 1. 両拠点で同じリポジトリを使う

- GitHub でリモートリポジトリを用意する
- 会社PC・自宅PCの両方でクローンする
- 変更同期は `git pull --rebase` を基本にする
- 会社PC・自宅PCの両方で `npm run git:sync:setup` を 1 回ずつ実行する

#### 会社PC / 自宅PC の Git 同期を自動化する

`npm run git:sync:setup` を実行すると、このリポジトリに対して次を設定する。

- `pull.rebase=true`
- `rebase.autoStash=true`
- `fetch.prune=true`
- `rerere.enabled=true`
- ログオン時に `MasterHub Git Sync Agent` を起動するスタートアップショートカット

起動後の動作は以下。

- 5分ごとに `fetch`
- ワークツリーが安全なときだけ `pull --rebase --autostash`
- 保存後 90 秒間変更が落ち着いたら、自動 `commit` と `push`

手動起動する場合:

```bash
npm run git:sync:agent
```

### 2. Supabase の Session Pooler 接続文字列を使う

- Supabase ダッシュボードで `Settings` → `Database` → `Connection string` を開く
- `URI` を選ぶ
- `方法` は `Session pooler` を選ぶ
- `Direct connection` も控えて、次の形式の接続文字列を `.env.local` に設定する

```env
DATABASE_URL="postgresql://postgres.PROJECT_REF:YOUR_DB_PASSWORD@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
DIRECT_URL="postgresql://postgres:YOUR_DB_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require"
REDIS_URL="redis://localhost:6379"
```

- パスワードに `#` や `@` が含まれる場合は URL エンコードする
- アプリ本体は `DATABASE_URL` の pooler 接続、Prisma migrate は `DIRECT_URL` の直結接続を使う
- Prisma 7 は `prisma/prisma.config.ts` を経由して `.env` と `.env.local` を読む

### 3. ローカルでは Redis だけ起動する

- `docker-compose.yml` はローカル検証用の Postgres / Redis を定義している
- Supabase を使う運用では DB はクラウド側を使うため、最低限 `redis` が起動していればよい
- Redis が必要な場合は `npm run docker:up` で起動する

### 4. Prisma コマンドは config 付きスクリプトを使う

- Prisma 7 では接続先を `prisma/prisma.config.ts` で解決する
- 直接 `npx prisma ...` を打つより、次の npm script を使う

```bash
npm run db:generate
npm run db:deploy
npm run db:push
npm run db:studio
```

### 5. 両拠点の初回セットアップ手順

```bash
npm install
npm run docker:up
npm run db:generate
npm run db:deploy
npm run dev
```

- `npm run dev` は Windows での Turbopack 権限問題を避けるため webpack モードで起動する
- 会社PCでも自宅PCでも `.env.local` の `DATABASE_URL` を同じ値にすれば、同じ Supabase DB を共有できる
- 実データは Supabase に集約されるため、PC間でDBファイルをコピーする必要はない

### 6. GitHub Actions で接続・Migration 状態を確認する

- Prisma 関連 workflow の repository secrets 名は `SUPABASE_DATABASE_URL` と `SUPABASE_DIRECT_URL` に統一する
- `SUPABASE_DATABASE_URL` は必須で、Session pooler 側の接続文字列を入れる
- `SUPABASE_DIRECT_URL` は Direct connection 側の接続文字列で、`Prisma Migrate Deploy to Supabase` では設定しておく
- `Check Prisma Migrations` は `SUPABASE_DIRECT_URL` 未設定時に `SUPABASE_DATABASE_URL` へフォールバックする
- 本番 deploy 用の secrets 一覧は `DEPLOYMENT.md` を参照する
- GitHub CLI で secrets 名を確認する場合は次を使う

```bash
gh secret list
```

- Prisma migrate deploy の workflow は `.github/workflows/prisma-migrate.yml`
- migration 状態だけ確認する workflow は `.github/workflows/check-prisma-migrations.yml`
- 手動実行は次で行える

```bash
gh workflow run "Check Prisma Migrations"
gh workflow run "Prisma Migrate Deploy to Supabase"
```

- 2026-04-02 時点の確認結果
- `gh secret list` で少なくとも `SUPABASE_DATABASE_URL` と `SUPABASE_DIRECT_URL` の存在を確認
- `Check Prisma Migrations` の最新成功 run で `17 migrations found in prisma/migrations` と `Database schema is up to date!` を確認
- `Prisma Migrate Deploy to Supabase` の最新成功 run で `No pending migrations to apply.` を確認
- つまり現在の main は 17 件の migration が存在し、Supabase 側は未適用なしで一致している

---

PC主体 + スマホ(PWA)連携を前提にした、カレンダーベースの予定・業務ハブ。

## アプリ配布

Master Hub は以下の形式で配布可能：
- **Web** - ブラウザアクセス（Docker/Windows Service）→ [DEPLOYMENT.md](DEPLOYMENT.md)
- **Desktop** - Electron アプリ（Windows/Mac/Linux）
- **Mobile** - Capacitor アプリ（iOS/Android）
- **PWA** - Progressive Web App（既に実装済み）

詳細は [APP-PACKAGING.md](APP-PACKAGING.md) を参照。

### クイックパッケージング

```bash
# デスクトップアプリ（Windows インストーラ）
npm run package:desktop

# モバイルアプリ（iOS + Android）
npm run package:mobile

# すべて一括
npm run package:all
```

## 前提

- Node.js / npm
- Docker Desktop（Postgres/Redisを使う場合）

## セットアップ

1) 依存関係

```bash
npm install
```

2) 環境変数

`.env.example` を参考に `.env.local` を作成。

3) DB/Redis起動（Docker）

```bash
npm run docker:up
```

4) Prisma

```bash
npm run db:generate
npm run db:deploy
```

5) 開発起動

```bash
npm run dev
```

### 未起動/落ちた時に自動起動させたい

- `npm run dev:keep` はヘルスチェック（`/api/health`）で起動確認し、
- 既に起動中なら二重起動せず待機
- 起動していなければ `npm run dev` を起動
- プロセスが落ちたら自動で再起動

#### Windows ログオン時に自動起動（任意）

権限（管理者）不要で確実なのは「スタートアップ」方式です。

※ 現在は bg方式（`dev:keep:bg`）で自動起動するようにしているため、既に設定済みでも `dev:startup:install` を一度実行するとショートカットが更新されます。

### Prisma

Prisma Client 生成:

```bash
npm run db:generate
```

※ Windows で `EPERM: operation not permitted, rename ... query_engine-windows.dll.node.tmp... -> ...query_engine-windows.dll.node` が出る場合:

- `npm run dev:stop:hard -- -Force`（まず強制停止）
- まだ残っている場合は `npm run dev:kill:port -- -Port 3000 -Force`（ポートを掴んでいるプロセスを停止）
- その後に `npm run db:generate` を再実行

マイグレーション適用（推奨: 名前の誤入力防止つき）:

```bash
npm run db:migrate
```

補足:

- `db:migrate` は migration name を検証し、誤って長い文字列（例: パス）を入力してしまう事故を防ぎます。
- Prismaを直接叩きたい場合は `db:migrate:raw` を使います。

```bash
npm run db:migrate:raw
```

## バックアップ（RPO 1時間: SharePoint）

- 1時間ごとのPostgreSQLバックアップを SharePoint（OneDrive同期）へ保存する手順は、[scripts/backup/README.md](scripts/backup/README.md) を参照。

## 開発起動

## 開発時のルール（運用）

- 変更は小さいパッチに分割し、各パッチ適用後に `npm run lint` と `npm run typecheck` を通してから次へ進む。
- 大きなパッチ（大きめの置換/移動/構造変更）を入れる前に、必ず WIP チェックポイントをコミットしてから作業する。
	- 例: `git add -A` → `git commit -m "WIP checkpoint: week-hub scroll"`
	- ロールバック: `git reset --hard <commit>`
	- 補足: `git commit -am` は「追跡済みファイル」しか含まれないため、新規ファイルがある場合は `git add -A` を使う。

※ 親フォルダ（`Master Hub/`）には中継用の `package.json` を置いてあるため、親フォルダから `npm run dev` / `npm run dev:keep` なども実行できます（内部的に `master-hub/` へ転送）。

最短（困ったらこれ1本）:

```bash
npm run dev:restart
```

または（どのフォルダからでも）:

```bash
\run-dev-restart.cmd
```

ターミナルでの定型（テンプレ）:

```bash
cd "C:\Users\desti\Master Hub\master-hub"; npm run dev
```

通常起動:

```bash
.\run-dev.cmd
```

落ちても自動再起動（ログ付き）:

```bash
.\run-dev-keep.cmd
```

VS Code のターミナルが落ちても巻き込まれないように、バックグラウンド起動:

```bash
npm run dev:keep:bg
```

または（親フォルダからでも）:

```bash
.\run-dev-keep-bg.cmd
```

停止（バックグラウンド起動したもの）:

```bash
npm run dev:stop
```

3000番の持ち主が残っていてタスク起動（`run: dev + worker`）と競合する時（強制停止 + lock削除）:

```bash
npm run dev:stop:hard -- -Force
```

再起動（止める→起動→health待ち）は上の `dev:restart` を使用します。

状態確認（pid / TCP / health）:

```bash
npm run dev:status
```

起動しているか確認:

```bash
npm run dev:health
```

困ったらこれ（まず状況確認）:

```bash
npm run dev:doctor
```

ブラウザを開く（デフォルトは `http://localhost:3000/`）:

```bash
npm run dev:open
```

※ ポート/パスを指定する場合:

```bash
npm run dev:open -- -Port 3000 -Path /api/health
```

3000番ポートが掴まれていて起動できない時（強制解放）:

```bash
npm run dev:kill:port
```

※ 注意: `dev:kill:port` はデフォルトでは「対象ポートを LISTEN しているPIDの一覧表示のみ」です。停止するには `-Force` が必要です。まず `npm run dev:status` / `npm run dev:doctor` で状況確認するのがおすすめです。

※ 複数PIDが対象になる場合は安全のため停止を拒否します（`-Force` を付けると実行）:

```bash
npm run dev:kill:port -- -Port 3000 -Force
```

※ ポート指定:

```bash
npm run dev:kill:port -- -Port 3000
```

スタートアップのショートカットを作り直したい（uninstall→install）:

```bash
npm run dev:startup:refresh
```

### クイックコマンド（運用）

- 状況確認: `npm run dev:status`
- 直す（再起動）: `npm run dev:restart`
- ログ末尾監視: `npm run dev:logs:tail`
- ログを開く: `npm run dev:logs:open`
- ログをクリア: `npm run dev:logs:clear -- -Archive`
- lock確認/解除: `npm run dev:lock` / `npm run dev:lock -- -Clear -Force`
- stuck復旧支援: `npm run dev:fix:stuck`（強制: `-- -Force`）
- ポートの持ち主: `npm run dev:port:who`

※ 親フォルダ（`Master Hub/`）からでも同じ `npm run ...` が実行できます。

※ PowerShell ではカレントフォルダの `.cmd` を実行するのに `.\` が必要です。
`run-dev-keep.cmd` だけだと「見つからない」になります。

VS Code の「タスクの実行」から以下を使うのが最短です。

- `run: dev + worker`（Web + Worker を同時起動）
- `bootstrap: base check`（docker/prisma/lint/build/e2e を一気に実行）

Web:

```bash
npm run dev -- -H 127.0.0.1 -p 3000
```

開発中に `ERR_CONNECTION_REFUSED` になる（devサーバーが落ちる/再起動する）場合は、落ちても自動で再起動しつつログを残す `dev:keep` が便利です。

```bash
npm run dev:keep
```

ログの末尾監視:

```bash
npm run dev:log
```

### Windows で落ちやすい原因

- Prisma の生成物更新時に DLL ロック（`EPERM` / `query_engine-windows.dll.node`）
	- 対策: `npm run dev` / `npm run worker` を停止してから `npm run db:generate` を実行
- 3000番ポート競合（`EADDRINUSE`）
	- 対策: 先に動いている dev を止める、または別ポートで起動

- `.next\\dev\\lock` が残って起動できない（"Unable to acquire lock"）
	- 対策: まず状況確認 `npm run dev:fix:stuck`
	- 強制復旧（next dev停止 + lock削除）: `npm run dev:fix:stuck -- -Force`
	- その後 `npm run dev:restart`

- `dev:keep` を複数起動して競合する
	- 対策: まず `npm run dev:stop` → `npm run dev:keep`（または `npm run dev:restart`）

- dev: http://127.0.0.1:3000

## 配布URL（固定HTTPS）

社内配布（PC/Electron・Android/TWA）を安定運用するために、**接続先URL（HTTPS）を1つに決めて固定**するのがおすすめです。

- PC（Electron）: `MASTER_HUB_URL`（末尾 `/` つき）
- Android（TWA）: `MASTER_HUB_MANIFEST_URL`（`https://YOUR_DOMAIN/manifest.webmanifest`）

例（PowerShell）:

```powershell
$env:MASTER_HUB_URL='https://YOUR_DOMAIN/'
$env:MASTER_HUB_MANIFEST_URL='https://YOUR_DOMAIN/manifest.webmanifest'
```

Windows 配布版は `.\scripts\package-desktop.ps1 -MasterHubUrl "https://YOUR_DOMAIN/"` で本番URLを埋め込んで生成できます。配布先PCで `MASTER_HUB_URL` を設定しなくても、そのURLへ接続します。

### Android（TWA）用: assetlinks.json（任意/推奨）

TWAの検証を通したい場合は、Web側で `/.well-known/assetlinks.json` を返せるようにしています。

- ルート: `https://YOUR_DOMAIN/.well-known/assetlinks.json`
- 必要な環境変数（Webサーバ側）:
	- `TWA_ASSETLINKS_PACKAGE_NAME`
	- `TWA_ASSETLINKS_SHA256_CERT_FINGERPRINTS`（SHA-256 フィンガープリントをカンマ区切り）

未設定の場合は 404 を返します。

Worker（リマインド等のジョブ実行）:

```bash
npm run worker
```

## 本番相当（production）確認

VS Code タスクの `run: prod (build + start)` を使うか、手動で以下。

```bash
npm run build
npm run start -- -H 127.0.0.1 -p 3001
```

- prod: http://127.0.0.1:3001

## 本番（推奨: Supabase + Linux VPS + Docker Compose）

前提:

- Supabase Postgres を用意し、`DATABASE_URL` と `DIRECT_URL` を確定
- Linux VPS 1 台で Docker / Docker Compose / Git / SSH を使えること
- Redis はまず `docker-compose.prod.yml` の同居 Redis を使う
- ファイル保存は Docker ボリュームに載せる
- Cloudflare は必要なら DNS / HTTPS / WAF の前段として使う

手順（VPS 上で実行）:

1) 環境変数ファイルを作成

- `.env.production.example` を参考に `.env.production` を作成（秘密情報は Git に入れない）
- Redis を同居させる最小構成では `REDIS_URL=redis://redis:6379`
- ファイル保存先は `MASTER_HUB_STORAGE_DIR=/data/masterhub-storage`
- 印刷/FAX の出力先は `PRINT_OUTBOX_DIR=/data/masterhub-outbox/print` と `FAX_OUTBOX_DIR=/data/masterhub-outbox/fax`

2) Web + Worker を起動

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

3) 停止

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production down
```

補足:

- `docker-compose.prod.yml` は `web` / `worker` / `redis` を同時に起動する
- `masterhub_storage` と `masterhub_outbox` の Docker ボリュームで帳票・写真・出力ファイルを保持する
- 今のコードベースは BullMQ worker を別プロセスで動かす前提なので、Cloudflare 単体ホスティングより VPS の方が適合する
- managed Redis を使いたくなったら、後で `REDIS_URL` だけ差し替えればよい

## Synology（Container Manager）

- 起動用: [docker-compose.synology.yml](docker-compose.synology.yml)
- 環境変数例: [.env.synology.example](.env.synology.example)
- 手順: [deploy/synology/README.md](deploy/synology/README.md)

## アプリ化（Windows / iOS / Android）

目的: 「ブラウザで開く」ではなく、PC/スマホにインストールするアプリとして起動する。

- Windows（Electron最小）: [apps/desktop/README.md](apps/desktop/README.md)
	- インストーラ生成（社内配布の土台）:
		- `cd apps/desktop`
		- `npm install`
		- `npm run dist`
		- または `powershell -File scripts/package-desktop.ps1 -MasterHubUrl "https://YOUR_DOMAIN/"`
		- 出力: `apps/desktop/dist/Master Hub-Setup-<version>.exe`
	- 更新（最小運用）: 新しい `Setup-<version>.exe` を配布して実行してもらう
	- 軽量更新確認: Vultr 側で `DESKTOP_APP_VERSION` と `DESKTOP_APP_DOWNLOAD_URL` を設定すると、アプリ内の「更新を確認」で最新 exe に誘導できる
	- 接続先URL（例）: `$env:MASTER_HUB_URL='https://YOUR_URL/'; npm run start`
- Android（TWA最小 / 推奨）: [apps/twa/README.md](apps/twa/README.md)
	- 更新をWeb側に寄せたい場合の最小土台（HTTPS + 固定ドメイン前提）
- iOS/Android（Capacitor最小）: [apps/mobile/README.md](apps/mobile/README.md)
```

## PWA（パッケージ版）実機チェックリスト

※ Service Worker 登録は `production` のみ有効です（devでは登録しません）。そのため **PWA動作確認は必ず prod で** 実施してください。

※ 重要: AndroidのChromeで「アプリをインストール（Install）」が出るには、基本的に **HTTPS（安全なコンテキスト）** が必要です。
LAN内の `http://<PC-IP>:3001` は環境によって「ホーム画面に追加」はできても、Install扱いにならないことがあります。
（運用・配布を想定する場合は、HTTPSのドメインで公開する構成に寄せてください）

### 方式A: ローカルHTTPS（mkcert）でInstallを確実化

PC上で mkcert を使い、LAN IP 向けの証明書を作って `https://<PC-IP>:3443` でアクセスできるようにします。

1) mkcert をインストール（PC）

```bash
winget install FiloSottile.mkcert
```

2) HTTPSでprod起動（ビルド + mkcert + Next起動 + HTTPSプロキシ）

```bash
npm run prod:https
```

ブラウザも自動で開く（任意）:

```bash
npm run prod:https:open
```

- 起動時に HTTPS URL を表示し、クリップボードにもコピーします。
- Nextは `http://127.0.0.1:3001`、HTTPSは `https://0.0.0.0:3443`（LANからは `https://<PC-IP>:3443`）です。

補足:

- HTTPS URL をもう一度コピーしたい場合: `npm run https:url:copy`
- PCのIPが変わった場合（Wi-Fi切替など）は、証明書を作り直してください: `npm run mkcert:lan`

3) Android端末側で「mkcertのルートCA」を信頼させる（初回だけ）

PCで以下を実行して `rootCA.pem` の場所を確認:

```bash
mkcert -CAROOT
```

その `rootCA.pem` をスマホへコピーし、Androidの設定から CA証明書としてインストールします。

- 設定 → セキュリティ → 暗号化と認証情報 → 証明書をインストール → CA証明書

その後、Chromeで `https://<PC-IP>:3443/?mode=week` を開き、Installが出るか確認します。

1) **prod起動**

```bash
npm run build
npm run start -- -H 127.0.0.1 -p 3001
```

スマホ実機からアクセスする場合（同一Wi-Fi想定）は、LAN公開で起動:

```bash
npm run prod:lan
```

接続URL（PCのIP）を表示する:

```bash
npm run lan:url
```

接続URL（先頭1件）をクリップボードにコピー:

```bash
npm run lan:url:copy
```

開発環境でSWを有効化して挙動を見る場合（任意）:

- `NEXT_PUBLIC_ENABLE_SW=1` を付けて起動
- HTTPS（または localhost）で開く必要があります

2) **インストール（Android / Chrome）**

- Android端末のChromeで `http://<PCのIPアドレス>:3001/?mode=week` を開く
- ブラウザメニュー → **「アプリをインストール」**（または「ホーム画面に追加」）
- インストール後、アプリとして起動して **初期画面が週表示（`/?mode=week`）で開く** ことを確認

3) **Android「端末戻る」対策（閉じない）**

- アプリ（standalone）で週ホームを表示
- **端末の戻るボタン**を押す
	- 期待: その場に留まる（アプリが閉じない）
- 週ホーム以外（例: 会計/管理/台帳）で端末戻る
	- 期待: アプリ内の戻るが効く（履歴が尽きた場合は週ホームへ戻る）

4) **オフライン最低限（起動/遷移の劣化確認）**

- アプリを一度オンラインで開いてから、端末を機内モード（オフライン）にする
- アプリを再起動
	- 期待: 最低限トップ（週ホーム相当）が表示される（真っ白にならない）

補足:
- オフライン時はAPI通信が落ちるため、データ取得系は失敗し得ます（UIが落ちずに表示できることを重視）。
- SWの更新が反映されない場合は、ブラウザの「サイトデータ削除」またはアプリの再インストールで切り分けできます。

## 動作確認用API

- `GET /api/health`
- `GET /api/accounting/ping`（会計連携は差し替え可能。初期はJDLスタブ）
- `POST /api/accounting/sync`（WorkEntryを会計連携へ同期。JDLはCSVファイル出力。`metaKeys` で追加列も指定可）
- `POST /api/accounting/query`（WorkEntryを会計条件で検索してJSONで取得。`metaEquals` で `accountingMeta` のキー一致検索も可）
- `POST /api/accounting/export`（WorkEntryを会計条件で検索してCSVで返す。`metaKeys` で追加列、`metaEquals` で `accountingMeta` のキー一致検索も可）
- `GET /api/accounting/exports`（JDL出力CSVの一覧）
- `GET /api/accounting/exports/:file`（JDL出力CSVのダウンロード）
- `POST /api/queue/reminders/enqueue`（BullMQのスモーク投入）

## Outlook（Graph）メール送信（報告書PDF添付）

会計ページの「Outlook送信（報告書PDF）」は、Microsoft Graph の `sendMail` を使ってPDFを添付送信します。

必要な環境変数（`.env.local`）:

- `OUTLOOK_TENANT_ID`
- `OUTLOOK_CLIENT_ID`
- `OUTLOOK_CLIENT_SECRET`
- `OUTLOOK_SENDER`（送信元のUPN/メール。例: `accounting@contoso.com`）

権限（Azure/Entra 側）:

- Graph API の `Mail.Send` を付与し、必要なら admin consent を実施

注意:

- 本番（`npm run build` + `npm run start`）で送信を許可するには、`ALLOW_EMAIL_SEND_IN_PROD=1` を設定してください。
- 宛先は「関係会社」の `email` を使います（未設定だと送信できません）。

## 会計CSVの抽出条件（プリセット）

ヘッダーの「経費CSV/人件費CSV/売掛CSV」は、DBの `AccountingExportPreset` を参照して出力条件を決めます。

- 取得: `GET /api/accounting/export-preset?key=expense`
- 更新: `POST /api/accounting/export-preset`（devでは `ADMIN_TOKEN` 未設定なら更新可。運用するなら `ADMIN_TOKEN` を設定し、`x-admin-token` ヘッダーを必須にしてください）

PowerShell からの更新テンプレ: [scripts/update-accounting-export-preset.ps1](scripts/update-accounting-export-preset.ps1)

## E2E

```bash
npm run e2e
```

開発中にE2E結果が追いにくい場合（ターミナルが文字化けする等）は、UTF-8で `e2e.log` にも残す以下が便利です。

```bash
npm run e2e:smoke
```

年→月ドリルダウンだけ実行:

```bash
npm run e2e:drilldown
```

ログ末尾監視:

```bash
npm run e2e:log
```

※ PowerShell では `del ... 2>nul` のような書き方でリダイレクト絡みのエラーになることがあるため、ログ削除は `Remove-Item e2e.log` を推奨します。

## プロンプト管理

プロンプトは `prompts/` に分割して管理。
## Git自動同期

自宅と会社で同じGitHubアカウントを使用する場合、自動同期スクリプトで変更を自動的にpull/push/commitできます。

### 使い方

**1回だけ実行（手動同期）:**
```bash
npm run git:sync
```

**5分ごとに自動同期（バックグラウンド）:**
```bash
npm run git:sync:5min
```

**10分ごとに自動同期（バックグラウンド）:**
```bash
npm run git:sync:10min
```

**VS Code Tasksから実行:**
- `Ctrl+Shift+P` → "Tasks: Run Task" → "git: auto-sync (once)" or "git: auto-sync (continuous 5min)"

### 動作

1. リモートから最新取得（`git fetch`）
2. リモートに新しいコミットがあれば `git pull --rebase`
3. ローカルに変更があれば自動コミット（タイムスタンプ付き）
4. リモートへプッシュ（`git push`）

### 注意

- ⚠️ コンフリクトが発生した場合は自動では解決できません（手動解決が必要）
- ⚠️ `.zip` / `.log` / `node_modules/` / `.next/` / `*-err.txt` / `*-out.txt` は自動コミットから除外
- ⚠️ 自宅と会社で同じファイルを同時編集すると競合が発生しやすくなります
- ✅ 作業開始前に一度手動で `git pull` することを推奨

### カスタマイズ

[scripts/git-auto-sync.ps1](scripts/git-auto-sync.ps1) でパラメータ変更可能：
- `-IntervalMinutes`: 同期間隔（デフォルト5分）
- `-Branch`: 対象ブランチ（デフォルトは現在のブランチ）
- `-CommitPrefix`: コミットメッセージのプレフィックス（デフォルト "Auto-sync"）