# Tailscale セットアップガイド（会社DB共有）

会社のデータベースをメインとし、自宅から Tailscale 経由で安全にアクセスする設定。

---

## 🎯 構成

```
会社（メインサーバー）:
  ├─ Docker (PostgreSQL + Redis) ← すべてのデータ
  ├─ Master Hub (本番運用)
  ├─ Tailscale
  └─ 常時起動

自宅（開発環境）:
  ├─ Next.js 開発サーバーのみ
  ├─ Tailscale
  └─ 会社DBへ接続（リアルタイム）
```

---

## ✅ メリット

### 会社ベースの理由
- ✅ **データは会社に保管**（セキュリティ面で安心）
- ✅ **会社PCが常時起動**なら自宅からも利用可能
- ✅ **バックアップも会社で一元管理**
- ✅ **業務データの流出リスク低減**
- ✅ **自宅では開発・閲覧のみ**

### Tailscale の利点
- ✅ **超簡単セットアップ**（5分）
- ✅ **エンドツーエンド暗号化**（WireGuard）
- ✅ **ポート開放不要**（ファイアウォール自動突破）
- ✅ **無料**（個人利用、100デバイスまで）
- ✅ **P2P接続**（低遅延）
- ✅ **自動再接続**

---

## 📋 セットアップ手順

### 1. Tailscale インストール（会社・自宅両方）

**ダウンロード:** https://tailscale.com/download

#### Windows の場合

1. インストーラーをダウンロード
2. 実行してインストール
3. タスクトレイの Tailscale アイコンをクリック
4. 「Log in」→ ブラウザでログイン（Google/Microsoft アカウント等）
5. 完了

#### 確認

```powershell
tailscale status
# Connected と表示されればOK
```

---

### 2. 会社の設定

#### 2-1. Tailscale IP 確認

```powershell
# 会社で実行
tailscale ip -4
```

**出力例:**
```
100.101.102.103
```

このIPをメモしてください。

#### 2-2. Docker再起動（ポート公開）

```bash
# 会社で実行
npm run docker:down
npm run docker:up
```

これで PostgreSQL (5432) と Redis (6379) が Tailscale 経由でアクセス可能になります。

#### 2-3. 接続テスト

```powershell
# 会社で実行（ローカル接続確認）
docker exec -t masterhub-db psql -U masterhub -d masterhub -c "SELECT 1"
```

**出力:**
```
 ?column?
----------
        1
(1 row)
```

---

### 3. 自宅の設定

#### 3-1. 環境変数ファイル作成

```powershell
# 自宅で実行
cd "C:\Users\desti\Master Hub\master-hub"
Copy-Item .env.home.example .env.local
```

#### 3-2. .env.local 編集

```env
# 会社のTailscale IPを設定（ステップ2-1で取得したIP）
OFFICE_TAILSCALE_IP=100.101.102.103

# 自動的にこれらが設定されます
DATABASE_URL="postgresql://masterhub:masterhub@100.101.102.103:5432/masterhub?schema=public"
REDIS_URL="redis://100.101.102.103:6379"

# JWT_SECRET と ADMIN_TOKEN は会社の .env.production と同じ値を設定
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
ADMIN_TOKEN=your-admin-token-change-this
```

#### 3-3. 接続テスト

```powershell
# 自宅で実行（会社DBへTailscale経由で接続）
$env:DATABASE_URL="postgresql://masterhub:masterhub@100.101.102.103:5432/masterhub"
docker run --rm -it postgres:16 psql $env:DATABASE_URL -c "SELECT 1"
```

**成功すれば:**
```
 ?column?
----------
        1
(1 row)
```

#### 3-4. Master Hub 起動

```bash
# 自宅で実行
npm run dev
```

ブラウザで `http://localhost:3000` にアクセス。

**会社と同じデータが表示されればOK！** ✅

---

## 🔧 トラブルシューティング

### エラー: "Connection refused"

**原因1: Tailscale 未接続**
```powershell
# 両方で確認
tailscale status
```

`Connected` でない場合：
```powershell
tailscale up
```

**原因2: 会社のDocker未起動**
```powershell
# 会社で確認
docker ps
```

起動していなければ：
```bash
npm run docker:up
```

**原因3: IP間違い**
- 会社で `tailscale ip -4` を再実行
- `.env.local` の `OFFICE_TAILSCALE_IP` を修正

---

### エラー: "Authentication failed"

**原因: パスワード間違い**

デフォルトは `masterhub:masterhub` ですが、変更している場合は `.env.local` を修正：

```env
DATABASE_URL="postgresql://masterhub:your-password@100.101.102.103:5432/masterhub?schema=public"
```

---

### 遅い・タイムアウト

**原因: P2P接続失敗（リレー経由）**

```powershell
# 両方で確認
tailscale status
```

`relay` と表示される場合はリレー経由。通常は数秒で `direct` に切り替わります。

**改善策:**
- 会社・自宅両方でファイアウォールを確認
- UPnPを有効化（ルーター設定）
- Tailscaleを再起動

---

### 自宅から会社DBに書き込めない

**原因: 権限設定**

```sql
-- 会社で実行
docker exec -t masterhub-db psql -U masterhub -d masterhub

-- PostgreSQL内で確認
\du
```

`masterhub` ユーザーに権限があることを確認。

---

## 🔒 セキュリティ

### 推奨設定

**1. Tailscale ACL（アクセス制御）**

Tailscale Adminパネル → Access Controls で設定可能：

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:home"],
      "dst": ["tag:office:5432,6379"]
    }
  ]
}
```

**2. PostgreSQL 接続制限**

会社の `docker-compose.yml` でIPフィルタ：

```yaml
db:
  environment:
    POSTGRES_HOST_AUTH_METHOD: md5
  command: >
    postgres
    -c listen_addresses='*'
    -c max_connections=100
```

**3. パスワード変更**

```bash
# 会社で実行
docker exec -t masterhub-db psql -U masterhub -d masterhub
ALTER USER masterhub WITH PASSWORD 'new-strong-password';
```

自宅の `.env.local` も更新。

---

## 📊 パフォーマンス

### 遅延測定

```powershell
# 自宅で実行
tailscale ping <会社のTailscale IP>
```

**目安:**
- 10ms以下: 非常に快適
- 10-50ms: 快適
- 50-100ms: やや遅い
- 100ms以上: リレー経由？ → 要確認

---

## 🔄 日常運用

### 朝の手順（自宅）

```bash
# 1. Tailscale接続確認
tailscale status

# 2. Master Hub起動
npm run dev

# 3. ブラウザで http://localhost:3000
```

### 夜の手順（自宅）

```bash
# 開発サーバー停止（Ctrl+C）
# Tailscaleは常時接続でOK
```

### 会社側

- Docker常時起動推奨
- 定期バックアップ（1時間ごと）
- Tailscale常時接続

---

## 💾 バックアップ

会社で定期バックアップを設定：

```bash
# 会社で実行（1時間ごと）
npm run db:backup
```

詳細は [scripts/backup/README.md](scripts/backup/README.md) 参照。

---

## 🚀 応用編

### スマホからもアクセス

1. スマホにTailscaleインストール
2. 同じアカウントでログイン
3. ブラウザで `http://<会社のTailscale IP>:3000`

**PWAとして追加すればアプリ化！**

### 外出先からも

Tailscaleは世界中どこからでも接続可能：
- カフェ
- 出張先
- 移動中（スマホ）

すべてエンドツーエンド暗号化。

---

## ❓ FAQ

**Q: 会社PCを停止するとどうなる？**
A: 自宅から使えなくなります。会社PC常時起動推奨。

**Q: 会社のネットワーク管理者に許可は必要？**
A: Tailscaleは通常のHTTPS通信なので、多くの場合は不要。不安な場合は確認を。

**Q: Tailscaleを会社に知られたくない**
A: ファイル共有同期（OneDrive等）を使用してください。

**Q: 自宅⇔会社の同期は自動？**
A: はい。同じDBを使うので即座に反映されます。

**Q: Tailscale無料版の制限は？**
A: 100デバイス、帯域無制限。個人利用なら十分。

**Q: オフラインでも使える？**
A: いいえ。Tailscale接続が必要。オフライン用には定期バックアップ併用を。

---

## 📚 参考リンク

- **Tailscale公式:** https://tailscale.com/
- **ドキュメント:** https://tailscale.com/kb/
- **料金プラン:** https://tailscale.com/pricing/

---

**最終更新:** 2026-01-14
