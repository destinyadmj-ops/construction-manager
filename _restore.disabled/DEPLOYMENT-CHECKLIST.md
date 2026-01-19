# 会社持ち込みパッケージ準備完了チェックリスト

作成日: 2026年1月10日  
Git タグ: release-company-deploy-20260110  
Git コミット: 1b68256

## ✅ 完了項目

### コードとビルド
- [x] プロダクションビルド成功（npm run build）
- [x] 型チェック成功（npm run typecheck）
- [x] Lint チェック成功（npm run lint）
- [x] すべての変更をコミット
- [x] リリースタグ作成（release-company-deploy-20260110）

### ドキュメント
- [x] デプロイメントガイド作成（DEPLOYMENT.md）
- [x] クイックスタートガイド作成（QUICKSTART.md）
- [x] README.md が最新の状態

### 最新機能（2026-01-10実装）
- [x] セル直接入力機能（DB連携の予測入力）
- [x] ファイル取り込み機能（関係会社）
- [x] 複数会社一括取り込み機能
- [x] アラートボタンと未読数バッジ
- [x] アラートAPI（/api/alerts/count）

## 📦 持ち込むファイル

### 方法1: Gitリポジトリをクローン（推奨）

会社のマシンで以下を実行：
```powershell
git clone <リポジトリURL>
cd master-hub
git checkout release-company-deploy-20260110
```

### 方法2: ZIPファイルで持ち込み

以下のコマンドで現在の状態をZIPにエクスポート：
```powershell
git archive --format=zip --output=master-hub-20260110.zip release-company-deploy-20260110
```

または、GitHubから直接ダウンロード：
1. リポジトリページを開く
2. タグ `release-company-deploy-20260110` を選択
3. "Download ZIP" をクリック

### 必須ファイル（ZIPに含まれます）
- すべてのソースコード
- package.json（依存関係）
- docker-compose.prod.yml（Docker設定）
- Dockerfile（イメージビルド設定）
- prisma/schema.prisma（DBスキーマ）
- .env.production.example（環境変数テンプレート）
- DEPLOYMENT.md（デプロイ手順）
- QUICKSTART.md（クイックスタート）

## 🚀 会社での展開手順（概要）

### ステップ1: 環境準備
1. Docker Desktop for Windows をインストール
2. リポジトリをクローンまたはZIPを展開
3. PowerShell を管理者権限で起動

### ステップ2: 環境変数設定
```powershell
cd master-hub
Copy-Item .env.production.example .env.production
# .env.production を編集（DATABASE_URL、REDIS_URL等）
```

### ステップ3: データベース起動（ローカル開発の場合）
```powershell
npm install
npm run docker:up
```

### ステップ4: アプリケーション起動
```powershell
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### ステップ5: 動作確認
ブラウザで http://localhost:3000 にアクセス

詳細は QUICKSTART.md を参照してください。

## 🔧 会社での初期設定

1. **初回ユーザー登録**
   - アプリケーションにアクセス
   - 管理者アカウントを作成

2. **従業員の追加**
   - 管理画面から従業員を追加
   - メールアドレスを設定

3. **現場の登録**
   - 現場台帳から現場を追加
   - 会社名、現場名を設定

4. **関係会社の登録**
   - 関係会社ページから取引先を追加
   - ファイル取り込み機能で一括登録も可能

## 🔐 セキュリティチェック

会社環境では以下を必ず実施：

- [ ] `.env.production` の `NEXTAUTH_SECRET` を強力なランダム値に変更
- [ ] データベースパスワードを変更
- [ ] Redis パスワードを設定
- [ ] HTTPS を設定（リバースプロキシまたはmkcert）
- [ ] ファイアウォール設定（必要なポートのみ開放）

## 💾 バックアップ設定

本番運用前に必ず設定：

1. データベースの自動バックアップ
   - 詳細: scripts/backup/README.md
   - SharePoint連携で1時間ごとバックアップ

2. 手動バックアップの実施
   ```powershell
   pg_dump -U postgres -d master_hub > backup.sql
   ```

## 📊 モニタリング

運用開始後の監視項目：

- [ ] ヘルスチェック: http://localhost:3000/api/health
- [ ] Docker コンテナ状態: `docker ps`
- [ ] ログ確認: `docker compose logs -f`
- [ ] ディスク容量
- [ ] メモリ使用量

## 🆘 トラブルシューティング

よくある問題と対処法：

1. **ポート競合**
   ```powershell
   npm run dev:kill:port -- -Port 3000 -Force
   ```

2. **Docker起動失敗**
   - Docker Desktop が起動しているか確認
   - WSL2 が有効か確認

3. **データベース接続エラー**
   ```powershell
   npm run docker:up
   ```

詳細は DEPLOYMENT.md のトラブルシューティングセクションを参照。

## 📞 サポート

問題が発生した場合：

1. DEPLOYMENT.md のトラブルシューティングを確認
2. ログファイルを確認（dev-keep.log）
3. エラーメッセージをメモ
4. 環境情報を収集（OS、Node.js、Dockerバージョン）

## 🎯 次のステップ

会社での運用開始後：

1. ユーザーフィードバックの収集
2. 必要な機能の追加検討
3. パフォーマンスチューニング
4. 定期的なアップデート適用

---

最終確認日: 2026年1月10日  
準備者: GitHub Copilot  
ステータス: ✅ 会社持ち込み準備完了
