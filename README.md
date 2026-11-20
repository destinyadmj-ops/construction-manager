
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
- VS Code でこの workspace を開いたときに `git: sync agent (save-triggered)` task を自動起動する

起動後の動作は以下。

- 5分ごとに `fetch`
- ワークツリーが安全なときだけ `pull --rebase --autostash`
- 保存後 90 秒間変更が落ち着いたら、自動 `commit` と `push`
- 現在の branch が `main` の場合、push 後に GitHub Actions の production deploy が走り、本番 `https://masterhubapp.org/` へ反映される

#### VS Code 保存から本番までの流れ

- VS Code で workspace を開くと、`.vscode/tasks.json` の `git: sync agent (save-triggered)` が自動起動する
- 保存で差分が発生すると `scripts/git-save-sync.ps1` が検知し、90 秒静止後に自動 `commit` と `push` を行う
- `main` への push は `.github/workflows/deploy.yml` を起動し、build が通れば `https://masterhubapp.org/` にデプロイされる
- つまりこの workspace では、保存した変更がそのまま本番反映の対象になる

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
- 表示高速化のキャッシュ/先読み仕様: 週予定(PC/モバイル)は `app/week-payload-cache.ts`(sessionStorage+メモリ)の前回データを即時表示し、必ず裏で再取得して置換する(PCは前後1週を先読み)。写真ダウンロードは `private, max-age=60` + ETag。無効化は週予定の `readWeekPayloadCache` 呼出と先読み(`prefetchTimer`)の除去、`app/api/documents/[id]/download/route.ts` の `DOWNLOAD_CACHE_CONTROL` 削除で元に戻る。
	- 補足: `git commit -am` は「追跡済みファイル」しか含まれないため、新規ファイルがある場合は `git add -A` を使う。
- 作業表☆同期の文字色(赤/黒)判定: セル全体の文字色は `.xlsx` 内の `styles.xml` から解決する(`src/server/excel-font-color.ts`。SheetJS の `cell.s` はフォント色を持たない)。rgb/theme(+tint)/indexed を RGB 化し、色相±10°・彩度70%以上・明度20〜65%を「赤」とする(橙/桃/茶/黄は赤にしない)。リッチ文字列は run 単位で判定し、色指定の無い run はセルのフォント色を継承せず黒(自動色)とする(Excel の表示どおり。run の無いセルはセルのフォント色)。赤黒が混在するセルは色ごとに別エントリへ分割し(個人×日付の予定セル内で黒=杠1・赤=杠2)、セル内の文字順を保つ。担当者名も同じ判定で、値は赤/通常の2値のみ。
	- 制限: `.xls` 形式の作業表☆ではセル全体の文字色を読めない(リッチ文字列の run 色のみ反映。同期結果の警告に表示)。`.xlsx` で保存すること。空行を含むシートでも色取得セルがずれないよう、`gridFromSheet` の行添字を実セル番地へ対応付けている(`createGridCellResolver`)。

- 週予定のセル設定(名前幅/日付幅/高さ(狭)/高さ(広)/表示密度)はタブ別(週/月/年 × 通常/日常 × PC/スマホ)に保存される(キー `week-hub:{kind}:{mode}:gridPrefs:{target}`)。ヘッダーは `HeaderActionsProvider.weekView` で現在のタブを知る。全文が見えない/複数現場・追記ありのセルは黒の ▼ を表示する(PC=ホバー、スマホ=タップで全文メニュー)。
- 月/週/年予定の表が画面幅に入り切らないときは、ツールバー(月=「今月」/週=「今週」の右、年=月見出し上の細い行)に横スクロールバーが出る(入り切る場合は非表示)。バーのドラッグ、本体/ヘッダーのスクロール、タッチパッド/Shift+ホイールは相互に同期する。実装は `app/top-horizontal-scrollbar.tsx`。

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

共有フォルダ同期の定期実行は、worker が起動直後に1回、その後ファイル更新時刻に関わらず行います（冪等）。週予定（作業表☆のみ読む。作業伝票は不要）は `SHARED_SYNC_SCHEDULE_INTERVAL_MS`（既定 5分）ごと、台帳・関係会社（アプリ内の作業伝票ブックが正本。共有フォルダには依存せず、ブック未作成のときだけ共有フォルダの作業伝票ファイルを使う）は `SHARED_SYNC_POLL_INTERVAL_MS`（既定 30分）ごとで、キューとロックは別々です。ふりがなの補完は週予定の同期で行います（週予定に変更があったとき、手動「全部」同期では常に実行）。週予定は原本が扱っている日付範囲を原本と完全一致させる差分同期で、画面（Web/PWA/モバイル/デスクトップの週・月・年）も5分おきに自動再取得されます。会社PCから原本を受信していない場合は、worker のコンテナから共有フォルダ(`/shared-source`)が見えていないと同期されません（下の「原本の受け取り」参照）。開発PCの `npm run worker` では既定で無効（実DBへ書き込まないため）で、`SHARED_SYNC_POLL_ENABLED=1` で有効化、本番(`NODE_ENV=production`)の worker は既定で有効です。実行するのは本番ホスト上の worker 1台のみにしてください。手動同期（`/api/sites/shared-sync`）とは排他され、実行中は 409 を返します。ログは `[worker][shared-sync] success: kind=… durationMs=… counts=…` の行で確認できます。worker は周期ごとの結果を Redis（`masterhub:shared-sync:poller:{scope}:{kind}`）へ記録し、最終成功が 週予定15分 / 台帳90分 を超えると現場台帳画面（編集権限者のみ）に「注意: … が止まっている可能性」を理由つきで表示します（詳細と本番での確認手順は DEPLOYMENT.md の「同期の確認」）。

週予定の差分同期の対応づけ（人×日のセルごと）: 原本の各項目と DB の既存予定を、(1) 同期キー一致 → (2) 同じ現場（現場ID一致）または同じ文字 → (3) 同じ位置（`scheduleGroupIndex` / `scheduleItemIndex` が同じ）の同期由来の予定、の順に対応づけ、対応した予定は削除+新規作成ではなく更新（ID を保つ）します。これにより、原本で現場名の文言だけを直したときも同じ予定が書き換わります。(3) は同期由来（`sharedExcelSync` の印あり）の予定だけが対象で、手入力の予定は対象外です。対応づかなかった同期由来の予定は削除、手入力の予定は残します。位置が誤って対応づいた場合（項目の削除と追加が同時など）も、更新後の内容は常に原本と一致します（`src/server/schedule-sync-plan.test.ts` で保証）。「希望休み」「休み」などの文言も除外せず、原本の文言のまま予定として取り込み・表示します（文言による除外処理は無い）。

完全同期の仕様（原本＝共有フォルダの `作業表☆.xlsx`。読み取りのみで、アプリから共有フォルダへは一切書き込まない）:

- 流れ: 共有フォルダの原本 → worker が5分ごとに読み取り → 週予定（`WorkEntry`）へ差分同期。週・月・年の各画面は同じ `WorkEntry` を表示するため、同期結果が3つの画面へそのまま反映される（画面も5分ごとに自動再取得）。
- 範囲: 原本が扱う日付範囲（週シートの最初の日〜最後の日）を原本と完全一致させる。範囲外の既存予定には触れない。原本が読めない/日付が読めない場合は何も削除しない（警告のみ）。
- 日付: 週シートの日付行を使うが、年が古いまま残っている日付（例: 1月のシートに前年の日付が入っている）は、曜日行と一致する年へ補正する。`coveredRange` もこの補正後の日付で決める。
- セルの分割: 1つのセルに複数の現場があるときは、読点・スラッシュ・改行・連続空白で分けるが、括弧（`（ ）` / `( )`）の内側では分割しない（例: `魁力屋(足立竹の塚、足立鹿浜)` は1件）。文字色（赤など）は項目ごとに引き継ぐ。「希望休み」「休み」も原本の文言のまま取り込む。
- 対応づけ: 上記の順（同期キー → 同じ現場/文字 → 同じ位置）。手入力・アプリ編集済みの予定は上書き・削除しない(下記「アプリ編集の保護」)。
- 検証: `src/server/work-table-extract.test.ts`（括弧・年補正・希望休み）と `src/server/schedule-sync-plan.test.ts`（収束）。実ファイルでは、同期後の DB が抽出結果とセル単位で一致し、文言違い・削除・余分な同期由来・印なし旧版・手入力を混ぜた状態から原本を同期しても完全一致に戻り、再実行で変化が無いことを確認済み（ローカル DB のみ）。

原本の受け取り（本番の標準＝会社PCから読み取り専用で送信）: 本番(Vultr)は社内LANの共有フォルダへ届かないため、会社PCの送信ツール（`scripts/shared-sync-agent.ps1`、導入は `scripts/install-shared-sync-agent.ps1`）が原本を読み取り専用で開き、変更があるときだけ `POST /api/sites/shared-sync/upload`（`Authorization: Bearer $SHARED_SYNC_UPLOAD_TOKEN`、32文字以上。未設定なら 503）で送ります。受信した原本は Redis に保存され、worker が5分ごとに照合して同期します（原本に変化が無い間は省略し、1時間ごとに念のため再同期）。共有フォルダ直読み（`MASTER_HUB_SHARED_SOURCE_DIR`）はフォールバックとして残り、受信分と両方あるときは更新日時が新しい方を使います。現場台帳画面の同期ステータスに「会社PCからの原本送信」（最終受信・最終連絡）が出て、稼働時間（日本時間 月〜土 7〜20時）に45分以上連絡が無いと警告します。緊急時は `/site-ledger/shared-upload`（編集権限者）から手動アップロードできます。サーバ設定・会社PCの導入・停電対策・リバースプロキシの body 上限(25MB以上)は DEPLOYMENT.md の「作業表☆の受け取り」。

アプリ編集の保護: 週予定をアプリで手入力・編集した予定は、原本の同期で上書き・削除されません（原本の同じ項目は、その編集済みの予定が取り込み済みとして扱われ、重複しません）。アプリで削除した原本由来の予定は、原本に残っていても再作成されません（削除記録は `UserUiSetting` の `shared-sync:{normal|daily}:tombstones` に保存、暫定400日）。原本側が編集済みの予定の内容を後から変えた場合は、新しい内容が別の同期由来の予定として追加され、編集済みの予定は残ります。

現場台帳・関係会社の取込元は『第32期作業伝票』の2タブ（当該月 `作業伝票YYYY年M月` と `作業伝票オリジナル`）のみです。同じ会社/現場は当該月タブが優先され、オリジナルは金額が空のときだけ補います。タブが無い場合は警告のみで他シートへは広げません。作業表☆（週予定）は現場・関係会社を自動作成しません。既存データの整理は `npx tsx scripts/ledger-requote.ts --file <作業伝票>`（既定 dry-run。`--apply --ids-file --confirm-host` で承認済みIDのみ削除、バックアップはリポジトリ外へ出力）。単体テストは `npm run test:unit`。

現場台帳の「作業伝票」ボタンは、編集権限保持者（PC）だけが入れる作業伝票ブック（`/site-ledger/work-slip-book`、Univer 製の Excel 型ブック）を開きます。共有フォルダの作業伝票は一方向の取込元（ブック画面の「共有フォルダから取込」/「Excelで置き換え」）で、アプリ内ブックが正本です。保存のたびに台帳・関係会社へ自動反映し（`runSharedSync` をバックグラウンド実行。実行中なら30分ごとの同期が反映）、ブックが存在する間は台帳の取込元は共有フォルダではなくこのブックになります。保存先は `MASTER_HUB_STORAGE_DIR`（既定 `.storage/`）配下の `work-slip-book/`（版ごとの JSON、直近30版）で、DB スキーマの変更はありません。同時編集は版番号で検出し、後から保存した側に「最新を読み込む」を促します。ブックを初めて作る取込時は .xls の書式（フォント・文字色・罫線の太さ・塗り・配置・折返し・列幅/行高・見出し行固定・目盛線・倍率）を BIFF8 から直接読んで引き継ぎます（`src/shared/xls-styles.ts`。SheetJS CE は .xls の書式を返さないため。.xlsx 取込は書式なし）。2回目以降の取込（「共有フォルダから取込」「Excelで置き換え」）は、シート名とセル位置で対応付けてセルの内容（値・数式）だけを更新し、列幅・行高・結合・固定行・書式・非表示は現在のブックのまま維持します（ブックにだけあるシートは残し、取込にだけあるシートは末尾に追加。取込側で空のセルは内容のみ消えて書式は残る）。注意: 位置で対応付けるため、取込元で行・列が挿入/削除されると内容がずれます（変更前の版は履歴から復元可）。ブックの上部（開始/数式/表示タブ行）の「列」「行」欄でシート全体の列幅・行高を1px刻みで一括変更できます（列10〜500px・行10〜300px、Ctrl+Z で戻せます）。Excel 出力は値・数式・結合・列幅・数値書式のみで、色・罫線・フォントは含まれません。

## 本番相当（production）確認

VS Code タスクの `run: prod (build + start)` を使うか、手動で以下。

```bash
npm run build
npm run start -- -H 127.0.0.1 -p 3000
```

- prod: http://127.0.0.1:3000

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
		- 本番配布に載せる場合は `public/downloads/Master-Hub-Setup-<version>.exe` へ配置し、`public/desktop-release.json` の version / downloadUrl / notes も同じ版へ更新する
	- 更新（最小運用）: 新しい `Setup-<version>.exe` を配布して実行してもらう
	- 軽量更新確認: `public/desktop-release.json` と `public/downloads/` に新しい exe を置くと、その版が `/api/desktop-release` で secrets より優先される。repo 管理を使わない場合だけ GitHub Actions secrets の `PROD_DESKTOP_APP_*` か `.env.production` の `DESKTOP_APP_*` を使う
	- 接続先URL（例）: `$env:MASTER_HUB_URL='https://YOUR_URL/'; npm run start`
- Android（TWA最小 / 推奨）: [apps/twa/README.md](apps/twa/README.md)
	- 更新をWeb側に寄せたい場合の最小土台（HTTPS + 固定ドメイン前提）
- iOS/Android（Capacitor最小）: [apps/mobile/README.md](apps/mobile/README.md)
```

## PWA（パッケージ版）実機チェックリスト

※ Service Worker 登録は `production` のみ有効です（devでは登録しません）。そのため **PWA動作確認は必ず prod で** 実施してください。

※ 重要: AndroidのChromeで「アプリをインストール（Install）」が出るには、基本的に **HTTPS（安全なコンテキスト）** が必要です。
LAN内の `http://<PC-IP>:3000` は環境によって「ホーム画面に追加」はできても、Install扱いにならないことがあります。
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
- Nextは `http://127.0.0.1:3000`、HTTPSは `https://0.0.0.0:3443`（LANからは `https://<PC-IP>:3443`）です。

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
npm run start -- -H 127.0.0.1 -p 3000
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

- Android端末のChromeで `http://<PCのIPアドレス>:3000/?mode=week` を開く
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
