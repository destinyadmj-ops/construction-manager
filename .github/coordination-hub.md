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
| done | C | app/site-ledger/page.tsx, app/api/sites/shared-sync/route.ts, src/server/shared-excel-sync.ts | 共有フォルダ Excel の一方向同期（作業表☆→週予定DB / 作業伝票→現場台帳・作業伝票）最小差分実装 | 2026-08-31 |
| done | B | app/week-hub.tsx | 編集OFF時の「編集から開始」警告のみを週タブ右側へ専用表示（赤文字）。他通知の既存表示は維持 | 2026-09-03 |
| done | B | src/server/shared-excel-sync.ts, src/server/schedule-user-order.ts, app/api/schedule/week/route.ts, app/api/schedule/month/route.ts, app/api/schedule/year/summary/route.ts, app/api/users/route.ts | 作業表☆を正として担当者名/並び順を作業予定軸で同期（unknownUsers解消と表示順統一） | 2026-09-03 |
| done | B | src/server/shared-excel-sync.ts | sharedExcelSync の重複混在と note化混在の根本修正（site正規化 + idempotent再構成 + 既存同期データ限定cleanup） | 2026-09-03 |
| done | B | src/server/shared-excel-sync.ts | 作業表☆の赤黒混在を色別グループ保存へ修正し、shared sync の1日ずれ根因（startAt日付境界）を修正。lint/typecheck通過、rowKey日付不一致0、再同期非増殖を確認 | 2026-09-08 |
| done | B | scripts/package-desktop.ps1, public/desktop-release.json, apps/desktop/package.json, apps/desktop/package-lock.json, public/downloads/Master-Hub-Setup-0.1.4.exe | 既存0.1.3導線を流用して desktop installer 基準版 0.1.4 を作成・配置。/api/desktop-release=0.1.4、SHA256一致、Desktop出力まで確認 | 2026-09-12 |
| done | B | src/server/shared-excel-sync.ts, src/server/schedule-user-order.ts, src/server/site-registry.ts, app/api/schedule/week/route.ts, app/api/schedule/month/route.ts, app/mobile/week-hub/page.tsx | 作業表☆同期の不整合修正（斎藤忠夫重複統合、黒赤グループ保証、ふりがな除去）を最小差分で実装。preview→sync→再sync検証、lint/typecheck通過 | 2026-09-12 |
| done | B | apps/desktop/main.cjs, app/sw-register.tsx, app/week-hub.tsx, src/server/shared-excel-sync.ts, app/api/sites/shared-sync/route.ts, src/server/queue/queues.ts, scripts/worker.ts | Desktop再読込遅延の計測と最小改善、作業表☆自動検知同期（interval polling + queue/worker）実装と検証 | 2026-09-15 |
| done | B | src/server/shared-excel-sync.ts, src/server/schedule-user-order.ts, src/server/site-registry.ts, app/api/schedule/week/route.ts, app/api/schedule/month/route.ts, app/mobile/week-hub/page.tsx, app/api/sites/shared-sync/route.ts | 作業表☆→週予定DBの未反映修正（duplicate canonicalization強化、既存shared行の再構成、site名正規化統一、preview/sync再検証） | 2026-09-18 |
| done | B | src/server/shared-excel-sync.ts | ユーザー名異体字統合（斎/齊/齋 等の同値マップ）とMASTERHUB側ふりがなbackfill追加。合成データで統合/backfillとも動作確認、実データでreはsync非増殖(155→155)確認 | 2026-09-24 |
| done | B | app/user-gate.tsx, app/week-hub.tsx, app/api/schedule/week/route.ts | ブラウザ版reload/初期表示10秒の実測(perf計装)と最小差分修正(auth/me重複解消・並列化)。prisma/schema.prismaは実測結果により未変更 | 2026-09-25 |
| done | B | apps/desktop/main.cjs | Windows Electronデスクトップ版のメモリ消費増大の実測(RSS/heap計測)。短時間(約5分)の試験では不定形増大なしと判断し修正は未実施(計測道具のみ残し、既定動作は不変) | 2026-09-25 |
| editing | B | src/server/shared-excel-sync.ts, src/server/site-registry.ts, app/api/sites/shared-sync/route.ts | shared-sync未反映(斎藤忠夫重複)・赤文字/文字化け/現場リンクずれの切り分け(Phase0環境検証→Phase1-4) | 2026-09-25 |
| done | B | .git（全履歴・force-push済） | .storageの実データ混入をgit historyから完全削除(filter-branch)完了。main+関連4タグをforce-push済み。**全PC/全chat: 次にpullする前に必ず下記手順を実施すること** | 2026-09-29 |

## ステータスボード（各チャットの現在地）
- A（設定方法）: 完了。Desktop 0.1.3 のアプリ内更新導線は本番反映済み。/api/desktop-release は 0.1.3 を返し、ユーザー環境も 0.1.3 導入済み前提で運用可能。
- B（エラー調査）: gridPrefs「日付幅195が戻る」修正は production(build 09:48:49Z)に**完全反映済み・revert不要**と確認。lint/typecheck OK。台帳を Git 追跡正本化（.github/coordination-hub.md）し PC 間引き継ぎを構築。ブラウザ版reload10秒調査は完了（auth/me重複5→3・並列化・index追加なしの判断、詳細は決定・方針ログ/失敗ログ参照）。lint/typecheck OK、実ビルドでの前後実測OK、e2e失敗は既存(環境要因)で今回変更と無関係と確認済み。Electronメモリ調査も完了（~5分観測でリーク未確認、修正なし。opt-in計測ツールのみ main.cjs に残置）。
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
- (C) 共有フォルダ同期は app/api/sites/shared-sync 経由の手動実行に限定し、Excel 原本への書戻しは行わない。作業伝票ファイル名は「作業伝票」パターン検出 + 対象期優先 + 更新日時最新で選定する。
- (B) 調整ハブの正本を `.github/coordination-hub.md`（Git 追跡）に移し、`/memories/repo/coordination-hub.md` は PC 固有のローカルミラー扱い。PC 間引き継ぎは GitHub 経由でこの正本を同期する。
- (B) 作業表☆同期時に担当者名を `User` へ自動同期（新規作成/既存有効化/名前更新）し、`week-hub:normal|daily:userOrder` を global UI setting へ保存。週/月/年API と users API はこの順序を優先して返す。
- (B) 週予定の編集OFF警告は汎用通知を移設せず、対象文言だけを week タブ右側に専用表示（赤文字）する方針を採用。既存の他通知（通信失敗/UndoRedo/削除結果など）は従来位置を維持。
- (B) sharedExcelSync 予定は siteId 必須 + scheduleEntryKind=site へ正規化。同期時に sharedExcelSync 由来のみ user/date範囲で再構成して idempotent 化し、UTC日付ズレ由来の重複を解消。追記表示は scheduleGroupNote 専用へ復帰。
- (B) 週/月セルの赤 `+` は「複数現場」条件ではなく実 overflow 判定（scroll/client 比較）で表示し、枠外右側に固定表示する方針へ更新。
- (B) 作業表☆同期は色別グループを `scheduleGroupIndex` へ保存（黒=0, 赤=1）し、`scheduleItemIndex` は色グループ内順序で保存する方針へ更新。週/月APIの既存groupingで2枠表示を実現。
- (B) desktop packaging は既存 `scripts/package-desktop.ps1` 導線を再利用し、wrapper 基準版を 0.1.4 へ更新。公開物は `public/downloads/Master-Hub-Setup-0.1.4.exe` と `public/desktop-release.json` を一致させ、`src/server/desktop-release.ts` は挙動変更なしで運用。
- (B) shared sync 実行時に同一正規化ユーザー名を canonical ID（global user order 優先、fallback=createdAt最古）へ寄せる方針を追加。duplicate User は hard delete せず showInSchedule=false 化。
- (B) sharedExcelSync 色は API 側で meta 優先を固定し、meta 色欠落時も scheduleGroupIndex から昼(default)/夜(red)を復元する方針を week/month へ適用。
- (B) Desktop 再読込遅延の最小差分方針として、SW/Cache リセット責務を `apps/desktop/main.cjs` に一本化し、`app/sw-register.tsx` の Electron 分岐は no-op 化。`app/week-hub.tsx` は初回 fetch のみ待機0ms・2回目以降のみ 250ms を維持。
- (B) 作業表☆自動同期は BullMQ `shared-sync` queue を新設し、worker 常駐 polling（既定2秒）で共有フォルダの source key（作業表/作業伝票の file+mtime）変化時のみ enqueue 実行する方針。初回起動時の自動実行は既定OFF（`SHARED_SYNC_POLL_SYNC_ON_START=1` で有効化）。
- (B) shared sync 未反映修正では、duplicate user 統合を「今回Excelに出た担当者」依存から全同名ユーザー対象へ拡張し、shared既存行は meta欠落/不整合でも userId+day+siteId+summary 一致なら再構成対象へ寄せる。site名は server/mobile で同一正規化（ふりがな括弧のみ除去）を共有する。
- (B) ユーザー名照合専用に漢字異体字同値マップ（斎/斉/齋/齊、辺/邊/邉、高/髙、崎/﨑 等）を追加し、site/company名の正規化キーとは分離した `normalizeUserKey()` でのみ適用。canonical選定は既存どおり global order優先→createdAt最古→id比較。表示名は canonical 側の既存表記を優先し、名前欄が空の場合のみ Excel 側表記で埋める（variant間での表記揺れ・巻き戻りを防止）。
- (B) MASTERHUB側だけに残るふりがなの backfill を追加。現在の 作業表☆ から得た site 名/会社名のキー集合と突き合わせ、Site.name/companyName と WorkEntry.summary の読み仮名括弧のみを安全に除去（一致しないものは保持）。sharedExcelSync 管理範囲内の行は通常の再構成で既にクリーンな表記に置き換わるため、backfill は主に管理範囲外の旧データに効く。

## 失敗・不具合・原因ログ（最重要・二重調査防止）
- (自宅PC/一般セッション) 症状: 2026-09-18朝の最終push（96e3908）以降、本番デプロイが失敗し続け、本番は1つ前のb6fdf99止まりだった（スマホ/PCとも今朝の最新修正が未反映）。
  - 原因1: scripts/tmp-validate-shared-sync.ts の検証用一時スクリプトが暗黙 any 型でtypecheckに失敗（デバッグ用にpushされたまま）。
  - 原因2: src/server/shared-excel-sync.ts:807 で `Prisma.join(assignments, Prisma.sql\`, \`)` と区切り文字にSqlオブジェクトを渡していた（正しくは文字列 `', '`）。
  - 対策: 両ファイルを最小修正（型注釈追加・区切り文字を文字列化）。typecheck/lint通過を確認しコミット8baf02f/4ce88c1でpush済み。deploy run 35308262847 success で本番反映済み（2026-09-18 13:51頃 JST）。B（作業表☆同期担当）は次回このtmpスクリプトをコミット対象から外すかbuild除外を検討してください。
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
- (B) shared sync 色反映対応後の確認で 1回目実行後に件数が増えたが、続けて再実行で sharedExcelSync 件数 1609→1609 に安定（増殖なし）。`labelColor` は red/default が保存され、note化/null site 再発なしを確認。
- (B) 1日ずれ根因を特定: `dayYmd` 自体は正しい一方、shared sync が `startAt` をローカル0時で保存していたため、API実行環境のTZ差で前日化。対策として shared sync 保存時刻をUTC日中帯へ固定し、cleanup抽出範囲を±1日拡張して既存ずれデータの再構成漏れを防止。
- (B) desktop 0.1.4 installer 生成時、コード署名証明書未設定のため未署名（Status: NotSigned）。配布は可能だが SmartScreen 警告リスクあり。
- (B) shared-sync route 検証で preview→sync→再sync は成功。2回目で shared 件数再増殖なし（1768→1768）を確認。sync 検証で .storage/sites 配下に作業伝票コピーが新規生成される点は既存仕様どおり。
- (B) 【重大インシデント・全chat向け】2026-09-25 発見: `.storage/`（sync実行のたびに各Siteへ作業伝票コピーを保存する実行時ストレージ）が2026-09-08頃から**git追跡・pushされ続けていた**（`git add -A`ベースのauto-sync agentが実データ検証の副産物ファイルを毎回巻き込んでいた）。発見時点で630ファイル・約693MBの実際の取引先/現場名を含む本物の作業伝票Excelがgit historyに残存。応急対応として`.gitignore`に`/.storage/`を追加し`git rm -r --cached .storage`で追跡解除（commit `ca4381a`/`2c1d1bd`）。
- (B) 【解決・全chat/全PC必読】2026-09-29 ユーザー指示によりgit history完全削除を実施。手順: (1) 作業前に`.git\refs\original`除去用の安全弁として`git clone --mirror`でローカルバックアップを`C:\Users\tsutsumi_s\construction-manager-backup-before-purge.git`に作成（当面保持、問題なければ後日削除可）。(2) auto-sync系バックグラウンドプロセス（git-auto-sync.ps1, git-save-sync.ps1）を作業中のみ一時停止（Stop-Process）。(3) `git filter-branch --force --index-filter "git rm -r --cached --ignore-unmatch .storage" --prune-empty --tag-name-filter cat -- --all` で全465コミット・全ローカルref・タグを書き換え（.storageに触れていない`origin/master`・`origin/fix/site-list-compact-8cols`・`feature/git-push-safe-readme`は無関係と確認済みで対象外）。(4) `refs/original`削除→`git reflog expire --expire=now --all`→`git gc --prune=now --aggressive`でオブジェクトを実削除（`git count-objects`で.storage関連オブジェクト数0を確認）。(5) `git push origin main --force`と影響を受けた4タグ(`master-checkpoint-20260114`/`release-company-deploy-20260110`/`rollback-latest`/`v0.1.0`)を`--force`でpush。(6) auto-sync系プロセスを再起動。**結果**: `git log --all -- .storage`が空になり、GitHub上のhistoryからも実データを完全除去済み。**全PC/全chatへの重要な影響**: mainの全コミットハッシュが変わっている（force-push済）。次に他PCで作業する際は、通常の`git pull`ではなく**`git fetch origin` → `git reset --hard origin/main`**（未コミット変更がある場合は退避してから）を行うこと。素朴に`git pull`すると分岐エラーになるか、意図せず古い履歴が復活する可能性がある。ローカルの作業用clone以外（他の作業ディレクトリやバックアップ）が残っている場合も同様に再同期が必要。history書き換え（BFG/git filter-repo等）は破壊的操作のため今回は実施せず、ユーザーへ判断を仰ぐ。全chat向け：今後 shared-sync を実データに対して実行検証する際は、実行後に`.storage/`配下の新規生成物がgit statusに出ないか必ず確認すること（今回の.gitignore追加で新規分は防止済み）。
- (B) Desktop perf 計測で `npm run dev --prefix apps/desktop` は `node main.cjs` 起動のため Electron API が使えず失敗（app undefined）。計測実行は `npx electron apps/desktop/main.cjs` または packaging 後 exe 起動で行う。
- (B) shared-sync 自動同期の実行検証は `npm run worker` で Redis 未接続（`REDIS_URL` 未設定）により本番経路まで未確認。型検査/lint は通過済み。
- (B) 2026-09-18 shared-sync 検証: preview 200 / sync 200 / 再sync 後 shared件数 148→148 で再増殖なし。week route で黒(default)+赤(red)2段groups を確認、ふりがな括弧残存は shared行・week payload とも未検出。ローカルDBは `User.showInSchedule` と `StoredDocumentKind.WORK_SLIP` 非対応の旧schemaだったため、そこは best-effort fallback を追加。
- (B) 2026-09-24 異体字統合/ふりがなbackfill検証: 実データ(NORMAL)で preview 200 / sync→再sync で shared件数 155→155 非増殖、黒(default)+赤(red)2段groups維持を確認。実データに現状 斎藤/髙橋 等の異体字重複・残存ふりがなは無かったため、合成テスト（同読み異体字ユーザー2件を作成しWorkEntryを付与→sync実行でcanonical側へ再付け替えを確認／Site.name・WorkEntry.summaryへ読み仮名括弧を注入→sync実行で除去を確認、いずれもテストデータは実行後に削除）で動作を直接検証。ローカルDBは `User.createdAt` 列はあるが `showInSchedule` 列が無い旧schemaのため、canonical選定は事実上 id文字列比較にフォールバックする点に留意。
- (B) 2026-09-25 ブラウザ版reload10秒調査: 実測用に本番相当ビルド(`next build`+`next start` port 3001、既存port 3000は他chat/実利用中のため触らず)で計測。修正前は `/api/auth/me` がreload毎に**5回**発火（UserGate本体1回＋週表(app/week-hub.tsx)独自fetch1回＋app/header.tsx・app/color-edit-controller.tsxの独自fetch各1回相当＋復元系1回）。`/api/schedule/week`のServer-Timingは users=20-320ms/entries=50-680ms/total=80-430ms程度で推移し、報告の10秒に対して支配的ではないと判断（**`(kind,startAt)`複合indexは追加しない**、実測未確認のためprisma/schema.prismaは無変更で確定）。
- (B) 対策: UserGate(app/user-gate.tsx)がmount時に取得した`/api/auth/me`結果(user+editMode)を`AuthMeContext`として子ツリーへ提供し、app/week-hub.tsxは独自fetchをやめてcontext参照のみに変更（fetch回数 週表分は1→0）。またapp/week-hub.tsxの`resolveEffectiveUserId→loadUserOrder→loadGridPrefs`直列awaitのうち、loadGridPrefsはuidに依存しないためPromise.allで並列化。再ビルド後の実測でreload毎の`/api/auth/me`発火は5→3（残り3件はapp/header.tsx・app/color-edit-controller.tsxの独自fetchおよびUserGate本体で、今回のロック範囲外のため未着手＝follow-up候補）。lint/typecheck OK。
- (B) 追加の実測所見（未修正・follow-up候補）: `resolveEffectiveUserId`の依存配列に`data?.users`等スケジュールデータが含まれるため、初期表示中にスケジュールが数回更新される間に同effectが2〜3回再実行され、その都度`/api/ui-settings`（userOrder/gridPrefs）へ本物の再フェッチが発生し200〜800ms程度を追加消費している。依存を安定化する修正は挙動変化のリスクがあり今回のスコープ外と判断し実施せず、原因のみ記録。
- (B) 2026-09-25 e2e確認: `npm run e2e`実行結果、`schedule cell/swap-cells/auto-fill`系や`weekhub: drag...`系は`/api/sites`へのadmin POSTやloginAsが早期に失敗（管理者トークン/Redis未設定等、環境要因）しており、修正前ビルド(port 3000の旧buildそのまま)・修正後ビルド(port 3001)の両方で同一の15件が失敗＝**今回の変更に起因する回帰ではない**ことを確認。DBへの実書き込みは早期失敗のため発生せず（`E2E Gate User`等の汚染行なし、`total users`はテスト前後で一致）。
- (B) 【重要・全chat向け】このPCの`.env.local`の`DATABASE_URL`はlocalhost Dockerではなく**リモートSupabase pooler**（aws-1-ap-northeast-1.pooler.supabase.com、実在の従業員名/現場名を含む本番相当データ）を指しており、dotenvは`.env`より`.env.local`を優先するため、ローカルの`npm run dev`/`build`/`start`/`e2e`は全てこのリモートDBに対して実行される。`.env`/`.env.local`はgitignore対象でPC固有のため、他PC/他chatでは値が異なる可能性がある。e2eや検証スクリプトを書く/実行する前に、必ず有効な`DATABASE_URL`のhostを確認してから書き込み系操作を行うこと（既知の落とし穴として/memories/repo/build-notes.mdにも追記）。
- (B) 2026-09-25 Electronデスクトップメモリ調査: `apps/desktop/main.cjs`にオプトイン計測(`MASTER_HUB_MEM_LOG=1`で`app.getAppMetrics()`+`process.memoryUsage()`を定期ログ、既定はOFFで挙動不変)を追加し、本番同等の pinned electron v35(apps/desktopの devDependency)で実測。ローカルserver(weekタブ表示、操作なし放置)を約2回合計約5分計測した結果、Browser約85-120MB/GPU約130-151MB/Utility約53MB/Tab(renderer)約90-99MBで推移し合計約400MB前後で安定しており、単調増加(リーク)は確認できなかった（t=120s付近で一時的に2つ目GPUプロセスが現れたが短時間で消えた。Chromiumの GPU Info Collection 相当と推定し問題なしと判断）。**実測範囲内ではリーク未確認のため、修正は実施していない**（合計~400MBはElectron/Chromiumベースのアプリとして異常な水準ではない）。一方で、`app/week-hub.tsx`に`isElectronShell && mode==='week'`限定の**2秒間隔で週全体を再 fetch+setData**する背景ポーリングが存在し（Browser版には無いElectron固有ロジック）、長時間使用でのCPU/GC負荷・体感メモリ増大の最有力候補としてfollow-up候補に記録(今回の短時間計測ではこれも目立った増加は見られず、推測の域を出ない。数時間規模の長時間計測は本セッションでは未実施)。lint/typecheck OK。
- (B) 【重要・根本原因】2026-09-25 shared-sync「斎藤忠夫重複が消えない」Phase0検証: (1) 実DB(Supabaseプーラー経由)へ`information_schema`照会し`User.showInSchedule`列・`StoredDocumentKind.WORK_SLIP`enum・24件のmigrationすべて適用済みを確認＝スキーマドリフトなし。(2) 実データに`斎藤　忠夫`(全角スペース,2026-03-23作成)と`齊藤 忠夫`(半角スペース,2026-09-03作成)の重複が実在することを確認。両文字列の`normalizeUserKey()`計算結果は理論上・実測上どちらも一致し、ロジック自体にバグはない。(3) **真因はコード不具合ではなくデプロイ環境**: `discoverSharedFiles`の既定パスは`\\192.168.0.210\guest\共有フォルダ`というWindows UNCパスだが、本番`web`/`worker`は`Dockerfile`で`node:20-bookworm-slim`(Linux)を使い、`docker-compose.prod.yml`にはこの共有フォルダをmountするvolumeも`MASTER_HUB_SHARED_SOURCE_DIR`環境変数もない。LinuxのNode.jsはUNCパスをそのまま解決できないため、**本番のroute.ts POST(手動同期)もBullMQ worker(自動polling)も、shared-sync実行のたびに`MISSING_SOURCE`相当で確実に失敗しており、consolidateDuplicateUsers等のロジックは本番では一度も実行されていない**と推定される（過去セッションの「実データでpreview/sync成功」ログは、すべてLANアクセス可能なこの開発PCからローカル実行した検証であり、本番コンテナ経由の検証ではなかった）。(4) 検証のため本セッションでこのPC(LAN到達可)から実データに対し`runSharedSync({kind:'NORMAL'})`を直接実行したところ、エラー0件・`counts`正常（sitesUpdated4/sitesMatched657/scheduleCreated1978等）で完走し、**実際に`斎藤　忠夫`(古い方)が`showInSchedule:false`化され`齊藤 忠夫`へ統合された**（本番と共有の同一Supabase DBのため、この統合はブラウザ側にも反映済み）。**結論**: 統合ロジックは正しく、これは実行環境（本番DockerからWindows共有フォルダへ到達不能）の構造的ギャップが真因。恒久対策には、(a)共有フォルダをCIFSマウントしてDockerボリューム化、または(b)LAN到達可能な社内PC/NASからの定期実行に切替、のいずれかの運用/インフラ判断が必要（コード修正のみでは解決しない）。ユーザーに方針確認中。


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
