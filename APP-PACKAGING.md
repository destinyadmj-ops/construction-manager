# Master Hub アプリパッケージングガイド

Master Hub をデスクトップアプリ（Windows/Mac/Linux）およびモバイルアプリ（iOS/Android）としてパッケージングする手順。

---

## 📦 概要

Master Hub は以下の形式でパッケージング可能：

- **Web** - ブラウザアクセス（Docker/Windows Service）
- **Desktop** - Electron アプリ（Windows/Mac/Linux）
- **Mobile** - Capacitor アプリ（iOS/Android）
- **PWA** - Progressive Web App（既に実装済み）

---

## 🖥️ デスクトップアプリ（Electron）

### 前提条件

- Node.js / npm
- 本番ビルド済み（`npm run build`）

### パッケージング

**すべてをビルド（インストーラ生成）:**
```bash
npm run package:desktop
```

**ビルドのみ（インストーラなし）:**
```powershell
.\scripts\package-desktop.ps1 -DirOnly
```

**接続先URL指定:**
```powershell
.\scripts\package-desktop.ps1 -MasterHubUrl "https://your-server.com"
```

### 出力

- **場所:** `apps/desktop/dist/`
- **ファイル:** `Master Hub-Setup-0.1.0.exe` (Windows)
- **サイズ:** 約 200-300MB（Electron + Chromium 含む）

### 配布

1. `Master Hub-Setup-0.1.0.exe` をユーザーに配布
2. インストーラを実行（ワンクリックインストール）
3. デフォルトURL: `http://localhost:3001`（環境変数 `MASTER_HUB_URL` で変更可能）

### カスタマイズ

[apps/desktop/package.json](apps/desktop/package.json) で設定変更可能：
- `appId`: アプリID
- `productName`: 製品名
- `icon`: アイコン
- `win.target`: ビルドターゲット（`nsis`, `portable`, `zip` 等）

---

## 📱 モバイルアプリ（Capacitor）

### 前提条件

- Node.js / npm
- **iOS:** macOS + Xcode
- **Android:** Android Studio

### パッケージング

**すべてをビルド（iOS + Android）:**
```bash
npm run package:mobile
```

**iOSのみ:**
```powershell
.\scripts\package-mobile.ps1 -Platform ios -Open
```

**Androidのみ:**
```powershell
.\scripts\package-mobile.ps1 -Platform android -Open
```

### 出力

- **iOS:** `apps/mobile/ios/` - Xcodeプロジェクト
- **Android:** `apps/mobile/android/` - Android Studioプロジェクト

### ビルド手順

**iOS:**
1. Xcode で `apps/mobile/ios/App.xcworkspace` を開く
2. Signing & Capabilities で Team を設定
3. Product → Archive でビルド
4. Distribute App でIPA生成

**Android:**
1. Android Studio で `apps/mobile/android/` を開く
2. Build → Generate Signed Bundle/APK
3. Keystore を設定してAPK/AAB生成

### 注意事項

- **静的エクスポート推奨:** `next.config.ts` に `output: 'export'` 追加
- **API URL:** Capacitor では絶対URLが必要（`https://your-server.com/api/...`）
- **認証:** モバイルでは Cookie/Session 制限あり → JWT/OAuth推奨

---

## 🌐 PWA（Progressive Web App）

**既に実装済み**

### 確認

- ブラウザで `http://localhost:3000` にアクセス
- Chrome: アドレスバーの「インストール」ボタン
- Edge: 設定 → アプリ → このサイトをアプリとしてインストール

### 機能

- オフライン対応（Service Worker: [public/sw.js](public/sw.js)）
- ホーム画面追加（[app/manifest.ts](app/manifest.ts)）
- プッシュ通知（実装予定）

---

## 🚀 全プラットフォーム一括ビルド

```bash
npm run package:all
```

以下を順次実行：
1. Web（Next.js）ビルド
2. Desktop（Electron）パッケージング
3. Mobile（Capacitor）同期

### 出力

```
.next/                      → Web（本番サーバー用）
apps/desktop/dist/          → Desktop インストーラ
apps/mobile/ios/            → iOS Xcodeプロジェクト
apps/mobile/android/        → Android Studioプロジェクト
```

---

## 📋 配布チェックリスト

### Desktop
- [ ] `npm run package:desktop` 成功
- [ ] `apps/desktop/dist/*.exe` 生成確認
- [ ] インストーラ実行テスト
- [ ] デフォルトURL動作確認
- [ ] メニュー機能確認（再読み込み、URLコピー等）

### Mobile (iOS)
- [ ] Xcode でビルド成功
- [ ] Signing & Capabilities 設定
- [ ] シミュレータで動作確認
- [ ] 実機テスト
- [ ] Archive → IPA 生成

### Mobile (Android)
- [ ] Android Studio でビルド成功
- [ ] Keystore 設定
- [ ] エミュレータで動作確認
- [ ] 実機テスト
- [ ] APK/AAB 生成

### PWA
- [ ] Service Worker 登録確認（`/sw.js`）
- [ ] Manifest.json 確認（`/manifest.json`）
- [ ] Lighthouse スコア確認（PWA基準）
- [ ] オフライン動作テスト

---

## 🛠️ トラブルシューティング

### Desktop: ビルドエラー

**エラー:** `electron-builder not found`
```bash
cd apps/desktop
npm install
```

**エラー:** `Icon generation failed`
- SVGアイコンが必要: `apps/desktop/build/icon.svg`
- 自動生成: `node generate-icons.mjs`

### Mobile: Capacitor sync エラー

**エラー:** `www folder not found`
```bash
npm run build
# または next.config.ts に output: 'export' 追加
```

**エラー:** `iOS/Android folder not found`
```bash
cd apps/mobile
npx cap add ios
npx cap add android
```

### API接続エラー（モバイル）

- **原因:** 相対パス（`/api/...`）が動かない
- **解決:** 環境変数で絶対URL指定
  ```typescript
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  fetch(`${API_BASE}/api/users`);
  ```

---

## 📚 参考リンク

- **Electron Builder:** https://www.electron.build/
- **Capacitor:** https://capacitorjs.com/
- **Next.js Static Export:** https://nextjs.org/docs/app/building-your-application/deploying/static-exports
- **PWA Checklist:** https://web.dev/pwa-checklist/

---

## 🔄 更新手順

アプリ更新時：

1. バージョンアップ:
   ```bash
   # Root
   npm version patch  # 0.1.0 → 0.1.1
   
   # Desktop
   cd apps/desktop
   npm version patch
   
   # Mobile
   cd apps/mobile
   npm version patch
   ```

2. 再パッケージング:
   ```bash
   npm run package:all
   ```

3. 配布:
   - Desktop: 新しいインストーラを配布
   - Mobile: App Store/Play Store に更新版アップロード
   - PWA: サーバー更新で自動反映

---

**最終更新:** 2026-01-10
