# Master Hub Desktop（最小）

目的: Master Hub を「ブラウザではなく」Windowsアプリとして起動するための最小Electronラッパー。

## 使い方

1) インストール

```bash
cd apps/desktop
npm install
```

2) 起動（接続先URLを指定）

```bash
$env:MASTER_HUB_URL='https://YOUR_URL/'
npm run start
```

- 社内利用: `http://<server>:3000/`
- 外部（VPN）: `https://<device>.<tailnet>.ts.net/` など（HTTPS推奨）

## できること（最小）

- `MASTER_HUB_URL` のURLをアプリとして表示します（中身はWeb版）
- メニュー:
	- 再読み込み / キャッシュ無視で再読み込み
	- 接続先URLコピー / ブラウザで開く
	- バージョン情報（Web側は `/api/version` を参照）

## 配布（exe/インストーラ）

1) 依存関係

```bash
cd apps/desktop
npm install
```

2) 生成（NSISインストーラ）

```bash
npm run dist
```

- 出力: `apps/desktop/dist/`
- 生成物例: `Master Hub-Setup-0.1.0.exe`

※ 署名（コードサイン）は未設定です。社内配布の土台として最小構成にしています。

## アイコン

- `public/icon.svg` から `apps/desktop/build/icon.ico` / `icon.png` を自動生成して使います（`npm run dist` / `pack` 実行時）。
- 差し替えたい場合は `public/icon.svg` を更新してください。

### 生成が失敗する場合（Windows）

- 一部環境で「symlink権限」で失敗することがあります。
	- 本リポジトリでは `signAndEditExecutable: false` にして回避しています（最小配布のため）。
	- 将来、アイコン埋め込み/署名までやる場合は Windows の「開発者モード」をONにするか、管理者権限で実行が必要になることがあります。
