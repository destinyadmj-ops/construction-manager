# 会社持ち込み用クイックスタートガイド

## 最短デプロイ（Docker使用）

### 1. 必要なファイルを準備

以下のファイルが必要です：
- リポジトリ全体（git clone または zipダウンロード）
- Docker Desktop for Windows がインストール済み

### 2. 環境変数ファイルを作成

```powershell
# .env.production を作成
@"
DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/master_hub
REDIS_URL=redis://host.docker.internal:6379
NEXTAUTH_SECRET=your-secret-key-here-change-this
NEXTAUTH_URL=http://localhost:3000
"@ | Out-File -Encoding UTF8 .env.production
```

### 3. PostgreSQL と Redis を起動（ローカル開発用）

```powershell
npm run docker:up
```

### 4. アプリケーションを起動

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### 5. アクセス

ブラウザで http://localhost:3000 を開く

### 6. 初回ユーザー登録

画面の指示に従って管理者アカウントを作成

## トラブルシューティング

### ポート競合が発生する場合

```powershell
# 3000番ポートを使っているプロセスを確認
npm run dev:port:who

# 強制終了
npm run dev:kill:port -- -Port 3000 -Force
```

### Docker が起動しない場合

1. Docker Desktop が起動しているか確認
2. WSL2 が有効になっているか確認
3. Hyper-V が有効になっているか確認（Windows Home以外）

### データベース接続エラーが出る場合

```powershell
# PostgreSQL の起動を確認
docker ps | Select-String postgres

# 起動していない場合
npm run docker:up
```

### ログを確認したい場合

```powershell
# Docker ログ
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f
```

## 停止方法

```powershell
# アプリケーションを停止
docker compose -f docker-compose.prod.yml --env-file .env.production down

# PostgreSQL/Redis も停止
npm run docker:down
```

## 再起動方法

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.production restart
```

## 完全リセット（データを削除して最初から）

```powershell
# すべて停止
docker compose -f docker-compose.prod.yml --env-file .env.production down
npm run docker:down

# Dockerボリュームを削除（データも削除される）
docker volume prune -f

# 再起動
npm run docker:up
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## 本番環境への移行

詳細は [DEPLOYMENT.md](DEPLOYMENT.md) を参照してください。

主なポイント：
- Azure Database for PostgreSQL を使用
- Azure Cache for Redis を使用
- HTTPS を設定
- 強力な NEXTAUTH_SECRET を設定
- 定期バックアップを設定
