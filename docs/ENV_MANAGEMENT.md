# 環境変数配布と秘密管理 — 手順ガイド

目的: 各環境（会社PC / 自宅PC / CI / 本番）で安全に `.env.production` を配布・管理し、将来的に Azure Key Vault / AWS Secrets / GitHub Secrets 等へ移行するための手順を示します。

---

## 1. 前提とファイル
- リポジトリには `.env.production.example` があるはずです。これを元に実際の値を入れた `.env.production` を作成します。
- 重要なキー例（必須/代表）:
  - `DATABASE_URL` — PostgreSQL 接続文字列（サーバ側、Prisma 等が参照）
  - `REDIS_URL` — Redis 接続文字列（BullMQ 等）
  - `ACCOUNTING_PROVIDER` — 会計連携プロバイダキー
  - `NEXT_PUBLIC_APP_NAME` — クライアント公開名（`NEXT_PUBLIC_` プレフィックスでクライアントに露出）
  - `NODE_ENV`, `PORT`, `ADMIN_TOKEN`, `OUTLOOK_*` など（環境に応じて）

**注意**: `.env*` は機密情報を含むため Git にコミットしてはなりません。`.gitignore` を確認してください。

---

## 2. 各環境への配布手順（短く）

### 会社PC（管理者が配布）
1. 管理者が安全な端末で `.env.production` を作成（テンプレの `.env.production.example` をコピーして編集）。
2. 安全な経路で配布：SCP/SFTP/Tailscaleファイル転送/社内の安全な共有（SharePoint 等）を推奨。メール添付は避ける。
3. 受け取り側は配置先をプロジェクトルートに置くか、デプロイ環境の指定場所に置く。
4. 権限設定：ファイルの読み取り権限を必要なユーザーだけに制限する。

例（scp）:
```powershell
scp .env.production user@server:/home/deploy/master-hub/.env.production
```

### 自宅PC（開発者向け）
- 原則: 開発者は本番のシークレットを直接扱わず、ローカル開発用の限定アカウントorテストDBを使うのが安全。
- どうしても本番値を使う場合は管理者から直接受け取り、同様に安全経路で配置する。

### CI（例: GitHub Actions）
- 推奨: シークレットは GitHub リポジトリ（または組織）シークレットに登録し、ワークフロー内で環境変数として利用する。ファイルを直接リポジトリに置かない。
- 簡易ワークフロー例（GitHub Actions）:
```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 18
      - name: Create .env.production
        run: |
          cat > .env.production <<EOF
          DATABASE_URL="${{ secrets.DATABASE_URL }}"
          REDIS_URL="${{ secrets.REDIS_URL }}"
          NEXT_PUBLIC_APP_NAME="${{ secrets.NEXT_PUBLIC_APP_NAME }}"
          EOF
      - name: Build
        run: npm ci && npm run build
```
- 代替: CI では `process.env` に直接注入してビルドする（ファイル化しない）ことも可。

---

## 3. 秘密管理サービスへの移行（概要）

### A: GitHub Secrets（まず簡単）
- Repo の Settings → Secrets → Actions に `DATABASE_URL`, `REDIS_URL` 等を追加。
- 上記のワークフロー例のように `${{ secrets.NAME }}` で参照。
- アクセス制御はリポジトリ管理者/組織ポリシーで制限。

### B: Azure Key Vault を使う場合
- 利点: ローテーション・RBAC・監査が可能。
- 概要手順:
  1. Azure Key Vault にシークレットを作成（`DATABASE_URL` 等）。
  2. CI（GitHub Actions）で `azure/login` と `azure/keyvault-secrets` アクションを使用して取得。

例（ワークフロー抜粋）:
```yaml
- uses: azure/login@v1
  with:
    creds: ${{ secrets.AZURE_CREDENTIALS }}
- uses: azure/keyvault-secrets@v1
  with:
    keyvault: my-keyvault
    secrets: DATABASE_URL,REDIS_URL
- name: Write env file
  run: |
    echo "DATABASE_URL=${{ steps.keyvault.outputs.DATABASE_URL }}" > .env.production
    echo "REDIS_URL=${{ steps.keyvault.outputs.REDIS_URL }}" >> .env.production
```

### C: AWS Secrets Manager を使う場合
- 概要手順:
  1. Secrets Manager にシークレット（JSON など）を登録。
  2. GitHub Actions で `aws-actions/configure-aws-credentials` を使い、`aws secretsmanager get-secret-value` で取得してファイル生成。

例（抜粋）:
```yaml
- uses: aws-actions/configure-aws-credentials@v2
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: ap-northeast-1
- name: Fetch secret
  run: |
    aws secretsmanager get-secret-value --secret-id my/app/prod --query SecretString --output text > secret.json
    jq -r '.DATABASE_URL' secret.json | xargs -I{} echo "DATABASE_URL={}" > .env.production
```

---

## 4. Docker / デプロイ時の利用
- `docker compose` で `.env.production` を指定して立ち上げ:
```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```
- K8s 環境では Secret を使って Pod 環境変数に注入。

---

## 5. 運用上の注意とベストプラクティス
- シークレットの最小権限原則（least privilege）を守る。
- 定期ローテーションと失効手順を確立する（DB パスワード等）。
- 監査ログ・アクセスログを有効にする（Key Vault / Secrets Manager で可能）。
- 開発者には本番クレデンシャルを直接渡さず、必要に応じて限定アカウントを発行する。
- バックアップ: シークレットは Vault のバックアップ/復元手順に従う。`.env.production` のバックアップは暗号化されたストレージで管理する。

---

## 6. 互換性・移行チェックリスト（短く）
- [ ] `.env.production.example` が最新であることを確認
- [ ] 重要なキーを Vault/Secrets に登録
- [ ] CI のワークフローでシークレット取得→環境ファイル生成を実装
- [ ] ロールベースのアクセス制御を設定
- [ ] シークレットのローテーション手順と連絡経路を用意

---

必要なら、あなたの組織向けに具体的な GitHub Actions / Azure / AWS の完全ワークフローテンプレートを作ります（例: Azure AD サービスプリンシパル作成手順、`AZURE_CREDENTIALS` の作り方等）。
