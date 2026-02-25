# Master Hub Android（TWA）

目的: Master Hub を **Androidアプリ（Trusted Web Activity）** として配布するための最小土台。

- Web（PWA）が“正”で、**更新はWeb配布に追従**します（APKを毎回作り直す頻度を下げられます）。
- ただし、TWAは **HTTPS** と **本番ドメイン固定** が基本です（`localhost` では現実運用になりません）。

## 前提

- Node.js / npm
- Java (JDK)
- Android Studio / Android SDK
- 配布先の **HTTPS URL**（例: `https://your.domain/manifest.webmanifest` が取得できる）

## セットアップ

1) 依存関係

```bash
cd apps/twa
npm install
```

2) 接続先（manifest）URLを指定

PowerShell例:

```powershell
$env:MASTER_HUB_MANIFEST_URL='https://demo.masterhub.local/manifest.webmanifest'
```

※ まずは **固定HTTPSドメイン**（例: `https://YOUR_DOMAIN/`）を1つ決めて、PC（Electron）/Android（TWA）で共通に使うのがおすすめです。

3) 初期化（Androidプロジェクト生成）

```bash
npm run init
```

- 生成物は `apps/twa/android/` に入ります。

4) ビルド

```bash
npm run build
```

5) 端末へインストール（接続済みの場合）

```bash
npm run install
```

## 社内配布（APK）

最小運用として「社内でAPKを配って入れてもらう」場合の手順です。

### 1) Android Studio で開く

- Android Studio を起動
- `Open` → `apps/twa/android/` を選択

### 2) 署名（Signed APK）を作る

Android Studio:

- `Build` → `Generate Signed Bundle / APK...`
- `APK` を選択
- 既存 keystore がなければ新規作成
- `release` を選択してビルド

生成物の場所は Android Studio の案内に従って確認してください。

### 3) 配布

- 生成した `*.apk` を社内配布（ファイル共有など）
- 端末側でインストール（不明なアプリの許可が必要な場合があります）

## 重要（TWAの前提）

- **HTTPS + 固定ドメイン** が基本です。
- TWAはサイトとの関連付け（Digital Asset Links）が絡むため、将来的に「完全にブラウザUIを出さない」体験に寄せたい場合は、
	ドメイン側の設定（`assetlinks.json` など）が必要になります。
	（まずは社内配布の土台として最小で開始し、必要になった時点で詰めるのがおすすめです）

このリポジトリは Web 側に `/.well-known/assetlinks.json` のルートを用意しています。
本番で使う場合は Web サーバ側の環境変数に以下を設定して再デプロイしてください。

- `TWA_ASSETLINKS_PACKAGE_NAME`
- `TWA_ASSETLINKS_SHA256_CERT_FINGERPRINTS`

## 運用（社内配布の最小）

- まずは **社内配布（APK）** で開始し、更新はWeb側を基本にします。
- “アプリ自体”を更新したいケース（アイコン/パッケージ設定変更など）のみAPKを再配布します。

## メモ

- TWAはサイトと同一オリジンが前提です（外部リンクは通常ブラウザに飛びます）。
- iOSはTWAがないので、iOSはPWA（ホーム画面追加）で運用する前提です。
