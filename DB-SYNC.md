# データベース自動同期ガイド

自宅と会社でMaster Hubのデータベースを自動同期する方法。

---

## 📋 概要

**問題:** 自宅と会社でアプリは同じだが、データベース（現場・予定・関係会社等）が別々。

**解決策:** 以下のいずれかの方法でDB同期。

### 方法の比較

| 方法 | 難易度 | リアルタイム性 | 推奨度 |
|------|--------|----------------|--------|
| **ファイル共有同期** | 低 | 30分〜1時間 | ⭐⭐⭐ 推奨 |
| SSH/SCP同期 | 中 | 30分〜1時間 | ⭐⭐ |
| 共有DB（VPN/クラウド） | 低 | リアルタイム | ⭐⭐⭐ 最も簡単 |
| PostgreSQLレプリケーション | 高 | リアルタイム | ⭐ 複雑 |

---

## 🌟 推奨：ファイル共有同期

OneDrive/Google Drive/共有フォルダ経由でDB同期。

### 前提条件

- **共有フォルダ** がマウント済み
  - OneDrive: `C:\Users\<User>\OneDrive\MasterHub-Sync`
  - 共有ドライブ: `\\server\share\MasterHub-Sync`
  - Google Drive: `G:\My Drive\MasterHub-Sync`

### セットアップ

**1. 共有フォルダを作成:**
```powershell
# OneDriveの場合
$syncFolder = "C:\Users\$env:USERNAME\OneDrive\MasterHub-Sync"
New-Item -ItemType Directory -Path $syncFolder -Force
```

**2. 1回だけ同期（テスト）:**
```bash
npm run db:sync:once -- -SharedFolder "C:\Users\YourName\OneDrive\MasterHub-Sync"
```

**3. 30分ごとに自動同期:**
```bash
npm run db:sync:30min -- -SharedFolder "C:\Users\YourName\OneDrive\MasterHub-Sync"
```

**4. 1時間ごとに自動同期:**
```bash
npm run db:sync:60min -- -SharedFolder "C:\Users\YourName\OneDrive\MasterHub-Sync"
```

### 動作

1. **ローカルDB**と**共有フォルダのDB**を比較
2. **新しい方を採用**（タイムスタンプベース）
3. 自動でエクスポート/インポート
4. メタデータ（更新時刻、ホスト名）を記録

### ファイル構成

共有フォルダに以下が作成されます：

```
MasterHub-Sync/
├── master_hub_latest.sql        # 最新のDBバックアップ
└── master_hub_meta.json         # メタデータ（更新時刻等）
```

---

## 🔒 共有DB（最も簡単）

VPNやTailscaleで自宅と会社を接続し、同じDBを使う。

### セットアップ（Tailscale例）

**1. Tailscaleインストール（自宅・会社両方）:**
- https://tailscale.com/download

**2. 自宅でPostgreSQLを外部公開:**

[docker-compose.yml](docker-compose.yml) を編集：
```yaml
services:
  postgres:
    ports:
      - "0.0.0.0:5432:5432"  # すべてのインターフェースで公開
```

**3. 会社の .env.production を編集:**
```env
DATABASE_URL="postgresql://postgres:your-password@<自宅のTailscale IP>:5432/master_hub?schema=public"
```

**メリット:**
- ✅ リアルタイム同期（同じDBを直接使用）
- ✅ セットアップ後は何もしなくて良い
- ✅ コンフリクトなし

**デメリット:**
- ⚠️ VPN接続が必須（オフライン時は使えない）
- ⚠️ ネットワーク遅延の影響

---

## 🔧 SSH/SCP同期（上級者向け）

SSH経由でリモートサーバーとDB同期。

### 前提条件

- 自宅/会社にSSH接続可能
- sshコマンドがパスに通っている

### 使い方

**自宅 → 会社へプッシュ:**
```powershell
.\scripts\db-sync.ps1 -Mode push -RemoteHost "company-server" -RemoteUser "admin" -RemotePath "~/master-hub-backup" -Once
```

**会社 → 自宅からプル:**
```powershell
.\scripts\db-sync.ps1 -Mode pull -RemoteHost "home-server" -RemoteUser "admin" -RemotePath "~/master-hub-backup" -Once
```

**自動判定（新しい方を採用）:**
```powershell
.\scripts\db-sync.ps1 -Mode auto -RemoteHost "remote-server" -RemoteUser "admin" -IntervalMinutes 30
```

---

## 📊 同期の確認

### 現在のDB状態を確認

```powershell
docker exec -t master-hub-postgres psql -U postgres -d master_hub -c "SELECT COUNT(*) FROM sites;"
docker exec -t master-hub-postgres psql -U postgres -d master_hub -c "SELECT COUNT(*) FROM \"workEntries\";"
```

### 同期ログ

スクリプト実行時にコンソールに表示：
- `[HH:mm:ss] Local is newer. Pushing...`
- `[HH:mm:ss] Remote is newer. Pulling...`
- `[HH:mm:ss] Databases are in sync. No action needed.`

---

## ⚠️ 注意事項

### 1. コンフリクト

- 自宅と会社で**同時に編集**すると、**後から同期した方が上書き**されます
- 解決策：
  - 作業前に必ず同期実行（`npm run db:sync:once`）
  - 共有DB方式に切り替え

### 2. バックアップ

同期前に自動で安全バックアップ作成：
- `backup_before_sync_YYYYMMDD_HHMMSS.sql`
- 問題があればこれで復元可能

### 3. ネットワーク

- **ファイル共有同期:** OneDrive/Google Drive が同期中でも問題なし
- **SSH/SCP同期:** VPN接続が必要
- **共有DB:** VPN接続が必須（オフライン不可）

---

## 🛠️ トラブルシューティング

### エラー: "Container is not running"

```powershell
npm run docker:up
```

### エラー: "Shared folder not accessible"

- OneDrive/Google Drive の同期が完了しているか確認
- 共有ドライブがマウントされているか確認
- VPN接続が有効か確認

### エラー: "Export failed"

- Dockerコンテナが正常か確認: `docker ps`
- ディスク容量を確認
- PostgreSQLが応答しているか確認: `docker exec -t master-hub-postgres pg_isready`

### データが反映されない

- 同期後にブラウザをリロード（Ctrl+F5）
- Next.js を再起動（`npm run dev:restart`）
- キャッシュクリア

---

## 📚 推奨ワークフロー

### 自宅で作業開始

```bash
# 1. Git同期
git pull

# 2. DB同期
npm run db:sync:once -- -SharedFolder "C:\Users\YourName\OneDrive\MasterHub-Sync"

# 3. 作業
# ...

# 4. コミット & プッシュ
git add -A
git commit -m "作業内容"
git push

# 5. DB同期
npm run db:sync:once -- -SharedFolder "C:\Users\YourName\OneDrive\MasterHub-Sync"
```

### 会社で作業開始

```bash
# 1. Git同期
git pull

# 2. DB同期
npm run db:sync:once -- -SharedFolder "C:\Users\YourName\OneDrive\MasterHub-Sync"

# 3. 作業開始
```

### 自動化（推奨）

バックグラウンドで常時同期：

```bash
# 自宅・会社両方で実行
npm run db:sync:30min -- -SharedFolder "C:\Users\YourName\OneDrive\MasterHub-Sync"
```

---

## 🔄 まとめ

| やりたいこと | コマンド |
|------------|---------|
| 1回だけ同期 | `npm run db:sync:once -- -SharedFolder "..."` |
| 30分ごと自動同期 | `npm run db:sync:30min -- -SharedFolder "..."` |
| 1時間ごと自動同期 | `npm run db:sync:60min -- -SharedFolder "..."` |
| 共有DB設定 | [docker-compose.yml](docker-compose.yml) + `.env.production` 編集 |

**最も簡単:** 共有DB（VPN/Tailscale） → リアルタイム同期、設定後は何もしなくて良い  
**VPN不要:** ファイル共有同期（OneDrive等） → 30分〜1時間ごと自動同期

---

**最終更新:** 2026-01-14
