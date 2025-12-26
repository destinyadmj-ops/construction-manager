# Master Hub

PC主体 + スマホ(PWA)連携を前提にした、カレンダーベースの予定・業務ハブ。

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


### 未起動/落ちた時に自動起動させたい

- `npm run dev:keep` はヘルスチェック（`/api/health`）で起動確認し、
	- 既に起動中なら二重起動せず待機
	- 起動していなければ `npm run dev` を起動
	- プロセスが落ちたら自動で再起動
	します。

※ 補足: 同じポート（既定: 3000）に対して `dev:keep` を複数起動すると `next dev` のロック競合になりやすいので、同一ポートは 1 本だけ起動する想定です（後発は「既に起動中」として終了します）。

#### Windows ログオン時に自動起動（任意）

権限（管理者）不要で確実なのは「スタートアップ」方式です。

- インストール: `npm run dev:startup:install`
- アンインストール: `npm run dev:startup:uninstall`

※ 現在は bg方式（`dev:keep:bg`）で自動起動するようにしているため、既に設定済みでも `dev:startup:install` を一度実行するとショートカットが更新されます。

※ スケジュールタスク方式（環境によっては権限で弾かれます）:

- インストール: `npm run dev:autostart:install`
- アンインストール: `npm run dev:autostart:uninstall`
```bash
npm run db:generate
npm run db:migrate
```

## 開発起動

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
