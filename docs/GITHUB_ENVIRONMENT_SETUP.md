# GitHub Environment (production) — 設定と保護ルール手順

このドキュメントは、CI ワークフローで `environment: production` を利用するための GitHub Environments の作成と保護ルール設定手順を示します。

※ 前提: あなたがリポジトリ管理者権限を持っていること。

## 1. 環境の作成 (UI)
1. GitHub リポジトリの `Settings` → `Environments` を開く。
2. `New environment` をクリックし、名前に `production` を入力して作成。

## 2. 環境保護ルール（推奨）
- **Required reviewers**: 本番環境へのデプロイを承認するレビュワー（個人またはコードオーナー）を設定します。PR をマージする前に環境承認が必要になります。
- **Wait timer**: 承認後に一定時間（例: 10 分）を待機させることで、緊急ロールバックやキャンセルの余地を残せます。
- **Deployment branches**: 特定のブランチのみデプロイを許可する（例: `main`）。

これらは UI で設定できます。

## 3. 環境シークレット設定 (UI / CLI)
### UI
1. `Environments` → `production` を選択 → `New secret`。
2. 名前を入力（例: `DATABASE_URL`）、値に本番の値を入れて保存。

### gh CLI で設定（推奨スクリプト）
```bash
# 環境シークレットをセット（対話式で値を入力）
gh secret set DATABASE_URL --env production
gh secret set REDIS_URL --env production
gh secret set AZURE_CREDENTIALS --env production
gh secret set AZURE_KEYVAULT_NAME --env production
```
※ `gh` は GitHub CLI がインストールされ、リポジトリへアクセスできることが前提です。

## 4. 環境承認フローの使い方（開発フロー）
- PR を作成してレビューを通し、`main` へマージすると CI が `environment: production` を利用してデプロイワークフローを実行します。
- 設定によっては、ワークフロー開始前に環境の承認者が UI から承認する必要があります。

## 5. 参考: GitHub Actions ワークフローの job 設定例
```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: npm ci && npm run build
```

## 6. 運用のおすすめ
- 環境シークレットはリポジトリの一般シークレットよりも厳しく管理する。
- 承認者は少数精鋭にして、誰が承認したかログを残す。
- デプロイ手順やロールバック手順を CODEOWNERS やデプロイ手順書にまとめ、承認者に周知する。
