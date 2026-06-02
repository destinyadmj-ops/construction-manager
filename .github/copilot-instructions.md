- このリポジトリは Next.js(App Router) + TypeScript + Tailwind で構築する。
- サーバ側の共通ロジックは `src/server/*` に置く（DB/Queue/外部連携）。
- DB は Prisma + Postgres を前提とし、スキーマは `prisma/schema.prisma` に集約する。
- ジョブ/リマインド等の非同期処理は BullMQ + Redis を使用する。
- 会計連携はプロバイダ差し替え方式にし、JDL 固有ロジックは `src/server/accounting/jdl.ts` 以外に漏らさない。
- 追加機能は最小の差分で実装し、README の手順が壊れないように更新する。
- 変更は小さいパッチに分割し、各パッチ適用後に `npm run lint` と `npm run typecheck` を通してから次へ進む。
- 大きなパッチ適用や大規模編集の前に、必ず WIP チェックポイントをコミットしてから作業する（例: `git add -A` → `git commit -m "WIP checkpoint: <topic reminding>"`）。

## マルチチャット連携（統合エージェント運用）
- 複数チャット（例: 「設定方法の詳細指示依頼」「エラーの調査と修正方法」「日本語設定の変更方法」）を並行運用している。交錯・重複を防ぐため、調整ハブを全チャットの共有台帳として使う。
- **調整ハブの正本は `.github/coordination-hub.md`（Git 追跡・GitHub 経由で会社/自宅など全 PC へ同期）。** ローカル高速参照用ミラーが `/memories/repo/coordination-hub.md`（VS Code workspaceStorage 内・PC固有・非同期）にある。PC を跨ぐ引き継ぎは必ず正本を基準にし、食い違ったら正本を優先する。
- 各チャットは作業開始時に必ず `.github/coordination-hub.md` を `read_file` し、他チャットの進行・ファイルロック・決定・既知の不具合/原因を確認してから着手する（ミラーがあれば併読可）。
- ファイルを編集する前に、ハブの「ファイルロック表」へ自分のチャット名で記載し、完了/中断時に解除する。
- 重要な決定・方針転換、失敗・不具合・原因究明は、その都度ハブの該当セクションへ1行で追記する（他チャットの二重調査・手戻りを防ぐ）。
- 他チャットへ依頼・連絡がある場合は、ハブの「引き継ぎ／連絡」へ宛先チャットを明記して残す。
- 同じファイル/領域に複数チャットが必要な場合は、先にハブ経由で担当を調整してから着手する。
- **PC 間引き継ぎ**: 退社/移動前に正本 `.github/coordination-hub.md` へ最新状況を追記して commit/push（auto-sync 可）。次の PC では `git pull` 後、各チャットへ「`.github/coordination-hub.md` を読んで A/B/C として運用ルールに従って」と指示すれば連携が継続する。
