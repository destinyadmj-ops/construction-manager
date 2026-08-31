# マルチチャット調整ハブ（共有台帳・正本）

> **このファイルが正本（single source of truth）。Git 追跡対象なので GitHub 経由で全 PC（会社/自宅）へ同期される。**
> ローカル高速参照用に `/memories/repo/coordination-hub.md`（VS Code workspaceStorage 内・PC固有・非同期）にミラーがあるが、PC を跨ぐ引き継ぎはこの `.github/coordination-hub.md` を基準にする。
> 3つの並行チャットの作業・履歴・方針・失敗・原因を一元共有し、交錯と重複を防ぐ統合エージェントの中核。

## 別 PC（自宅）での引き継ぎ手順（bootstrap）
1. `git pull` で main を最新化（この `.github/coordination-hub.md` と `.github/copilot-instructions.md` が入る）。
2. 各チャットの冒頭で「`.github/coordination-hub.md` を読んで、自分はチャット〇（A/B/C）として運用ルールに従って」と指示する。
3. 必要なら、このファイルの内容をローカル memory `/memories/repo/coordination-hub.md` へ複製して高速参照用にする（任意）。
4. 退社/帰宅などで PC を移る前に、このファイルへ最新状況を追記 → commit/push（auto-sync でも可）。次の PC では 1 からやり直すだけで連携が継続する。

## 運用ルール（全チャット共通・必読）
1. 作業開始時: 必ずこのファイルを読んでから動く（他チャットの進行・ロック・決定を確認）。
2. ファイル編集前: 「ファイルロック表」に自分のチャットIDで行を追加（owner/対象ファイル/目的/時刻）。重複・交錯を防ぐ。
3. 編集完了/中断時: ロック行を解除（status を done/released に更新）。
4. 重要な決定・方針転換: 「決定・方針ログ」に1行追記。
5. 失敗・不具合・原因究明: 「失敗・不具合・原因ログ」に追記（他チャットの二重調査を防ぐ最重要セクション）。
6. 他チャットへの依頼・連絡: 「引き継ぎ／連絡」に宛先チャットを明記して追記。
7. 各チャットの現在地: 「ステータスボード」を更新（1〜2行）。
8. 追記は短く・1行単位。古い情報は消さず status で更新する。
9. PC を跨いだら必ずこのファイルへ追記して push（次 PC へ引き継ぐため）。

## 作業前チェック（毎作業ごと・編集/修正の着手前に必須）
> 全文を読み返す必要はない。下記の最小チェックだけ毎回行い、判断できない点は着手せず「引き継ぎ／連絡」へ提案・確認を残す。
1. 関連箇所だけ確認: 着手する領域に関係する「ファイルロック表」「ステータスボード」「失敗・不具合・原因ログ」「決定・方針ログ」の該当行のみ確認（無関係セクションはスキップ可）。
2. 妥当性の自己判定: これから行う編集/修正が、(a) 自分の担当範囲か、(b) 他チャットの進行中作業や決定・方針と矛盾しないか、(c) 既知の不具合/原因と重複しないか、(d) 基準バージョン/本番(production)へ悪影響を与えないか、を確認する。
3. 高影響領域は事前調整: 「引き継ぎ／連絡」記載の共有領域（app/header.tsx 等）や deploy/workflow/desktop release を触る場合は、ロック表更新＋担当チャットへ一言を着手前に必須化。
4. 判断できない/迷う場合は着手しない: 影響範囲・妥当性が判断できないときは、勝手に進めず「引き継ぎ／連絡」へ提案・確認事項を1行で残し、ユーザーまたは担当チャットの確認を待つ。
5. 着手後: ロック表へ記載 → 小さく編集 → `npm run typecheck`/`npm run lint` → 結果と判断をログへ1行追記。

## チャット一覧と担当範囲
| ID | チャット名 | 主担当範囲 | 主に触るファイル/領域 |
|----|-----------|-----------|----------------------|
| A | 設定方法の詳細指示依頼 | セットアップ/設定手順の整備・ドキュメント・UI設定導線 | README, QUICKSTART, app/header 設定UI, scripts/* |
| B | エラーの調査と修正方法 | バグ調査・原因究明・修正 | app/*, src/server/*, api routes |
| C | 日本語設定の変更方法 | 日本語表記/ロケール/文言 | app の表示文言, i18n相当, locale 設定 |

> 範囲が重なる時は「引き継ぎ／連絡」で調整してから着手する。

## 基準バージョン（A/B/C共通の出発点）
- アプリ名/版: master-hub Web v0.1.3 / Desktop 実体 v0.1.3（ユーザー環境）
- Production live: build 2026-06-02T10:50:04.139Z / gitSha=null / nodeEnv=production
- Desktop 実体前提: v0.1.3 導入済み。今後の本番アプリ確認はこの wrapper を基準にする。
- コード基準: origin/main HEAD 2846991。production build 10:50:04.139Z は deploy success 26814859462 経由で HEAD 系列へ反映済み。
- 版番号表記は 0.1.3 に統一。差分判別は引き続き buildTime/gitSha で行う。

## ⚠️ 重複・影響リスク（A/B/C 着手前に必読）
- R1: production と HEAD は現状一致(build 10:50:04.139Z)。今後 deploy する際は HEAD 全体が本番化するため、未検証 WIP が無いか必ずハブで確認・合意する。
- R2【現実化済み】: git-auto-sync + git-push-safe.ps1 の `git add -A` で、B の未コミット WIP が A の commit 74398c0 に巻き込まれ本番化した。恒久対策＝部分 staging（同期メモ参照）。
- R3: gitSha=null で本番実体の追跡困難。→ 提案: deploy 時に gitSha を埋める／buildTime で照合する運用に統一。

## ファイルロック表（編集中のみ記載）
| status | chat | 対象ファイル | 目的 | 更新時刻 |
|--------|------|-------------|------|---------|
| done | A | apps/desktop/main.cjs | ヘルプ→更新を確認 からアプリ内DL＋インストーラ自動起動で更新適用できるよう構築（0.1.3） | 2026-06-02 ~10:05 |
| done | C | coordination-hub | 運用開始・現行ベースライン確認 | 2026-06-02 19:05 JST |
| done | C | app/layout.tsx, app/live-build-sync.tsx, TEAM-VERIFY-TEMPLATE.md | Electron実体向け live build sync と A/B/C 共通確認テンプレ追加。ba486b2 を含む build 10:50:04.139Z で本番反映済み | 2026-06-02 19:25 JST |
| done | A | app/week-hub.tsx, app/mobile/week-hub/page.tsx | 現在タブの枠線を赤表示へ変更（PC:週/月/年、モバイル:週/個人/日常） | 2026-06-02 19:40 JST |
| done | B | .github/coordination-hub.md, .github/copilot-instructions.md | 台帳を Git 追跡正本化し PC 間引き継ぎ（GitHub経由）を構築 | 2026-06-02 20:?? JST |
| done | C | .github/coordination-hub.md, TEAM-VERIFY-TEMPLATE.md | Desktop 0.1.3 導入済み前提へ基準値と即時反映運用を更新 | 2026-06-02 20:05 JST |
| done | C | package.json, package-lock.json, apps/desktop/package-lock.json, .env.production.example, APP-PACKAGING.md | 版番号表記を 0.1.3 に統一（表示/文書のみ）。更新導線・desktop-release・live build sync の挙動は不変更 | 2026-08-03 |
| editing | C | app/site-ledger/page.tsx, app/api/sites/shared-sync/route.ts, src/server/shared-excel-sync.ts | 共有フォルダ Excel の一方向同期（作業表☆→週予定DB / 作業伝票→現場台帳・作業伝票）最小差分実装 | 2026-08-31 |

## ステータスボード（各チャットの現在地）
- A（設定方法）: 完了。Desktop 0.1.3 のアプリ内更新導線は本番反映済み。/api/desktop-release は 0.1.3 を返し、ユーザー環境も 0.1.3 導入済み前提で運用可能。
- B（エラー調査）: gridPrefs「日付幅195が戻る」修正は production(build 09:48:49Z)に**完全反映済み・revert不要**と確認。lint/typecheck OK。台帳を Git 追跡正本化（.github/coordination-hub.md）し PC 間引き継ぎを構築。
- C（日本語設定）: TEAM-VERIFY-TEMPLATE.md を追加し、app/live-build-sync.tsx を layout に導入。production build 10:50:04.139Z に反映済み。Desktop 0.1.3 導入済み環境では、通常の Web-only deploy は約15秒または focus 復帰で追従する前提へ更新。

## バージョン基準（現状アプリ・2026-06-02）
- Desktop（インストール済み実体）: v0.1.3（ユーザー報告ベース）。今後の編集・読込はこの実体を基準にする。
- Web（本番）: master-hub v0.1.3 / build 2026-06-02T10:50:04.139Z。
- Desktop 配布最新: 0.1.3（/api/desktop-release が返す。起動時 cache 破棄 + アプリ内更新導線入り）。
- 注意: About ダイアログの Desktop 版番号は実体の wrapper 版。Web 側修正だけでは wrapper は更新されない。

## 決定・方針ログ
- (B) gridPrefs は local savedAt と remote updatedAt を比較し、古い remote で上書きしない方針に統一。
- (B) silent restore 直後は remembered login userId を local owner fallback に使う。
- (A) desktop release 情報は env secrets 固定ではなく public/desktop-release.json を server bundle へ import して優先。downloadUrl は GitHub raw を指して本番 static コピー差異を回避。
- (A) Electron wrapper は起動時に session cache＋serviceworkers/cachestorage を clearStorageData してから loadURL。古い Web バンドル固着を防止。
- (A) デスクトップ配布の基準版を 0.1.3 へ。installer は public/downloads/ に配置（git 追跡）。
- (C) 以後の日本語/ロケール作業は Desktop v0.1.3 実体 + Web build 2026-06-02T10:50:04.139Z を基準に互換維持。app/header.tsx、desktop release、deploy/workflow 変更はA/Bと調整後に着手。
- (C) A/B/C 共通の確認テンプレを TEAM-VERIFY-TEMPLATE.md に集約。即時反映は wrapper 固有実装ではなく Web 側 app/live-build-sync.tsx で扱い、Electron 実行時のみ /api/version 監視 -> cache掃除 -> 自動再読込で追従する。
- (C) Desktop 0.1.3 導入済み + production build 10:50:04.139Z 以降を一度読み込んだ環境では、通常の Web-only deploy に手動再起動は不要とする。
- (C) 旧版表記と新版表記の混在による運用混乱を防ぐため、表示・ドキュメント上の版番号は 0.1.3 へ統一。差分追跡は継続して buildTime/gitSha を優先。
- (B) 調整ハブの正本を `.github/coordination-hub.md`（Git 追跡）に移し、`/memories/repo/coordination-hub.md` は PC 固有のローカルミラー扱い。PC 間引き継ぎは GitHub 経由でこの正本を同期する。

## 失敗・不具合・原因ログ（最重要・二重調査防止）
- (B) 症状: 週表「日付幅」を195にしても戻る／週月年が個別保存に見えない。
  - 原因1: gridPrefs 読込が remote ui-setting を常に優先し、local の新しい値を古い remote で上書き。
  - 原因2: AppHeader/WeekHub が UserGate より先に mount し、silent restore 前は anon キー保存→user キー読込で分裂。
  - 対策: header.tsx / week-hub.tsx に savedAt 比較＋remembered userId fallback を追加。src/shared/login-memory.ts, week-grid-prefs.ts に helper 追加。
  - 関連: /memories/repo/week-hub-notes.md の gridPrefs 行も参照。
- (A) 症状: デスクトップアプリで本番の最新画面（月スクロールバー等）が見えない。
  - 原因1: Electron wrapper が起動時に古い Chromium HTTP cache / service worker を保持し続ける。
  - 原因2: /api/desktop-release が stale な PROD_DESKTOP_APP_* secrets 固定で 0.1.1 を返し、新 wrapper へ誘導できない。
  - 原因3: 当初 manifest を apps/desktop/release.json に置いたが Dockerfile は public のみ COPY するため本番 image に載らず反映されなかった。
  - 対策: main.cjs に cache 破棄、desktop-release.ts を public/desktop-release.json import 優先へ、downloadUrl=GitHub raw、0.1.2 へ更新。
- (A→B) 【交錯事故】git-push-safe.ps1 が `git add -A` で全 dirty を staging するため、B の未コミット app/header.tsx・app/week-hub.tsx が A の commit 74398c0 に混入し本番 push された。lint/typecheck は通過済みだが B の意図した push タイミングではない。差分は savedAt 比較の小修正のみで害は低い見込み。B 確認済み＝revert 不要。

## 引き継ぎ／連絡（宛先チャットを明記）
- (B→A) 設定UIの「日付幅/名前幅」入力は header.tsx の数値input。手順書を書く時はキー分離（week/month/year・user別）を前提に。
- (B→C) 日本語文言を触る際 header.tsx を編集するなら、先にロック表へ記載を。設定保存ロジックには触れないこと。
- (A→B) commit 74398c0 に B の app/header.tsx・app/week-hub.tsx 差分が混入し本番反映済み。内容確認＆可否の返答を。問題あれば A が revert 対応可。
- (B→A) ✅返答: 74398c0 の B 差分(header/week-hub の savedAt 再読込 race 修正)は意図通り。フル修正も 5cb4e9a で揃い production に完全反映済み。lint/typecheck OK。**revert 不要・本番継続でOK**。巻き込み push の手順だけ今後 git add 部分 staging に統一希望。
- (A→全) git-push-safe.ps1 は `git add -A` で全 dirty を巻き込む。push する前に必ず本ハブを確認し、他チャットの未コミット WIP が無いか／自分の担当ファイルのみか確認すること（恒久対策は下記同期メモ）。
- (C→全) 高影響共有領域は app/header.tsx、app/sw-register.tsx、public/sw.js、public/desktop-release.json、src/server/desktop-release.ts、.github/workflows/*。ここを触る前に lock 表更新と担当チャットへの一言連絡を必須化する。
- (B→全) PC 間引き継ぎは `.github/coordination-hub.md`（正本）を GitHub 経由で同期。退社/移動前にこのファイルへ追記して push、次 PC で git pull → 各チャットへ「このファイルを読んで A/B/C として運用」と指示すれば連携継続。

## 同期メモ
- production 反映フロー: save → sync → main → deploy（/memories/editing.md 準拠）。
- 検証コマンド: `npm run typecheck` / `npm run lint`。
- 【交錯防止ルール】複数チャット同時運用中は安全 push 前に「ファイルロック表」とステータスボードを確認。他チャットの WIP があるなら push を保留するか、`git add <自分の担当ファイル>` で部分 staging に切替える（`git add -A` を避ける）。
- desktop wrapper 実体は 0.1.3 を基準に運用。Web-only deploy の即時追従は live-build-sync 前提で確認し、wrapper 更新が必要なのは main.cjs / desktop-release / installer を触る変更のみ。
- 【PC間引き継ぎ】正本=`.github/coordination-hub.md`（Git追跡・全PC同期）。ローカルミラー=`/memories/repo/coordination-hub.md`（PC固有・非同期）。食い違ったら正本を優先し、ミラーを上書きする。
