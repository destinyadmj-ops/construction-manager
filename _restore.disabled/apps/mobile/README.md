# Master Hub Mobile（iOS / Android）

目的: Master Hub を「ブラウザではなく」スマホアプリとして起動するための最小Capacitorラッパー。

この方式はWebViewで既存UIを表示します（ネイティブ作り直しはしません）。

## 前提

- iOS: macOS + Xcode
- Android: Android Studio

## セットアップ

1) 依存関係

```bash
cd apps/mobile
npm install
```

2) 接続先URLを設定

- apps/mobile/capacitor.config.ts の `server.url` を本番URLへ変更
  - iOS向けに HTTPS を推奨（VPN内HTTPS URLが理想）

3) プラットフォーム追加

```bash
npx cap add ios
npx cap add android
```

4) 同期してIDEを開く

```bash
npm run cap:sync
npm run cap:open:ios
npm run cap:open:android
```

## 配布

- 試運転: TestFlight（期限あり）
- 恒久運用（個人端末混在）: App Store（Unlisted）
