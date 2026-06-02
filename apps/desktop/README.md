# Master Hub Desktop（最小）

目的: Master Hub を「ブラウザではなく」Windowsアプリとして起動するための最小Electronラッパー。

配布版は、ビルド時に埋め込んだ接続先URLを優先します。Vultr 本番URLを指定してビルドすれば、配布先PCで環境変数を設定しなくても同じURLへ接続します。

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

配布版を本番URL固定で作る例:

```powershell
..\..\scripts\package-desktop.ps1 -MasterHubUrl "https://YOUR_DOMAIN/" -DesktopVersion "0.1.1"
```

## できること（最小）

- `MASTER_HUB_URL` のURLをアプリとして表示します（中身はWeb版）
- メニュー:
	- 再読み込み / キャッシュ無視で再読み込み
	- 接続先URLコピー / ブラウザで開く
	- 更新を確認（`/api/desktop-release` を参照）
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

- `npm run dist` / `npm run pack` は `MASTER_HUB_URL` が必須です。
- 例: `set MASTER_HUB_URL=https://YOUR_DOMAIN/` の後に実行します。

またはルートから接続先を固定して生成:

```powershell
.\scripts\package-desktop.ps1 -MasterHubUrl "https://YOUR_DOMAIN/" -DesktopVersion "0.1.2"
```

- `scripts/package-desktop.ps1` も `-MasterHubUrl` が必須です。
- `localhost` / `127.0.0.1` を配布用に埋め込むことは既定で禁止しています。ローカル検証で必要な場合だけ `-AllowLocalhostUrl` を付けてください。

- 出力: `apps/desktop/dist/`
- 生成物例: `Master Hub-Setup-0.1.2.exe`
- 本番の update API へ載せる場合は `public/downloads/Master Hub-Setup-0.1.2.exe` へ配置し、`apps/desktop/release.json` も同じ version / downloadUrl に更新します

署名付き配布を行う場合の例:

```powershell
.\scripts\package-desktop.ps1 -MasterHubUrl "https://YOUR_DOMAIN/" -DesktopVersion "0.1.2" -WindowsCertFile "C:\certs\masterhub.pfx" -WindowsCertPassword "<password>"
```

Windows の証明書ストアを使う場合の例:

```powershell
.\scripts\package-desktop.ps1 -MasterHubUrl "https://YOUR_DOMAIN/" -DesktopVersion "0.1.1" -WindowsCertSha1 "<thumbprint>"
```

証明書を指定しない場合は未署名のまま生成されます。

## 更新運用（軽量）

フル自動差し替えではなく、「更新確認して新しいインストーラへ誘導する」方式です。

- Web / API の変更はサーバー更新だけで反映されます
- Electron ラッパー自体を更新したいときだけ、新しい exe を再配布します
- アプリ内の「更新を確認」は `/api/desktop-release` を見て、新しい exe のダウンロードURLへ誘導します

Vultr 側の環境変数例:

```env
DESKTOP_APP_VERSION="0.1.2"
DESKTOP_APP_DOWNLOAD_URL="https://YOUR_DOMAIN/downloads/Master%20Hub-Setup-0.1.2.exe"
DESKTOP_APP_RELEASE_NOTES="デスクトップ起動時のキャッシュ更新を改善"
```

- `apps/desktop/release.json` が存在し、そこに書かれた version が env より新しい場合は repo 側 release 定義が優先されます

## 別PC確認

1. 新規インストール確認

```powershell
Get-FileHash ".\apps\desktop\dist\Master Hub-Setup-0.1.2.exe" -Algorithm SHA256
```

- 配布前に SHA256 を控える
- 別PCで installer を実行し、初回起動で本番URLへ接続できることを確認する

2. updater 確認

- 0.1.1 以下を入れた端末で、サーバー側の `DESKTOP_APP_VERSION` か `apps/desktop/release.json` を 0.1.2 に向ける
- アプリの「ヘルプ」→「更新を確認」で新しいバージョン案内が出ることを確認する
- 0.1.2 導入後は同じ操作で「最新です」表示に戻ることを確認する

## アイコン

- `public/icon.svg` から `apps/desktop/build/icon.ico` / `icon.png` を自動生成して使います（`npm run dist` / `pack` 実行時）。
- 差し替えたい場合は `public/icon.svg` を更新してください。

### 生成が失敗する場合（Windows）

- 一部環境で「symlink権限」で失敗することがあります。
	- 本リポジトリでは `signAndEditExecutable: false` にして回避しています（最小配布のため）。
	- 将来、アイコン埋め込み/署名までやる場合は Windows の「開発者モード」をONにするか、管理者権限で実行が必要になることがあります。
