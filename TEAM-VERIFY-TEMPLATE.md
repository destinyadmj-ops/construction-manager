# Team Verify Template

目的: A/B/C の各チャットが、同じ基準で Desktop 実体版と Web build を確認し、save -> sync -> main -> deploy -> 本番アプリ反映までを同じ手順で扱うための共通テンプレ。

## 1. 着手前

1. .github/coordination-hub.md を確認する。必要なら /memories/repo/coordination-hub.md は高速参照用 mirror として併読する。
2. 触るファイルを lock 表へ記載する。
3. 変更が次のどちらかを先に分類する。
   - Web 変更: app, src/server, public の画面/API/スタイル変更。
   - Wrapper 変更: apps/desktop/main.cjs, public/desktop-release.json, public/downloads, src/server/desktop-release.ts, workflow, packaging。

## 2. ベースライン採取

変更前に次を必ず記録する。

```text
[Change Baseline]
Date:
Chat:
Target URL:
Desktop URL:
Desktop version:
Electron:
Chrome:
Node:
Release info URL:
Web version:
Web buildTime:
Web gitSha:
main HEAD:
Deploy run:
Change class: Web / Wrapper
```

取得元:

1. Desktop 実体版: アプリの ヘルプ -> バージョン情報。
2. Web build: /api/version。
3. main HEAD: `git log --oneline -1`。
4. Deploy run: GitHub Actions の Deploy to Production。

## 3. 即時反映フロー

Web 変更時の標準フロー:

1. コードを保存する。
2. auto-sync が main へ push する。
3. Deploy to Production が本番へ反映する。
4. 本番アプリは /api/version を約15秒ごとと focus 復帰時に確認する。
5. buildTime または gitSha が変わったら、Electron 実行時は master-hub 系 cache と service worker を掃除して自動再読込する。

補足:

1. 入力欄にフォーカス中は即 reload せず、入力が外れたタイミングで反映する。
2. Desktop の About に出る Desktop version は wrapper 版で、Web 変更だけでは通常変わらない。
3. Wrapper 変更を含む場合は、/api/desktop-release の version と installer 再配布が必要。
4. Desktop 実体が 0.1.3 導入済みなら、通常の Web-only deploy は約15秒または focus 復帰で追従する前提で確認する。
5. Desktop 実体が 0.1.2 以下なら、live build sync 自体を読み込ませる最初の 1 回だけ再起動またはキャッシュ無視再読み込みが必要。

## 4. 変更後確認

Web 変更:

1. /api/version の buildTime が更新されたか確認する。
2. 本番ブラウザで対象画面を確認する。
3. 本番デスクトップアプリで同じ画面を確認する。
4. Desktop About の Web buildTime が本番の /api/version と一致するか確認する。

Wrapper 変更:

1. /api/desktop-release が新 version を返すか確認する。
2. installer を取得して更新する。
3. Desktop About の Desktop version が更新されたか確認する。
4. その上で Web build と対象画面を確認する。

## 5. 共有メモの更新

完了時に coordination-hub へ次を短く記録する。

1. 変更対象。
2. buildTime。
3. Desktop 実体版。
4. production 反映可否。
5. 他チャットが触ると危険な共有領域があれば、その注意。

## 6. 高影響領域

次を触る前は、lock 表更新と A/B/C 間の一言連絡を必須にする。

1. app/header.tsx
2. app/sw-register.tsx
3. app/live-build-sync.tsx
4. public/sw.js
5. public/desktop-release.json
6. src/server/desktop-release.ts
7. apps/desktop/main.cjs
8. .github/workflows/*