**Vercel デプロイ手順（簡易）**

1. Vercel にサインアップ / ログイン。
2. 今回は GitHub Actions を使うので、Vercel の `Project` を作るか、CLI で `vercel link` して `org id` と `project id` を取得します。
   - ローカルで取得する例:
     - `npm i -g vercel` または `npx vercel login`
     - `npx vercel projects ls` で `org` と `project` を確認
3. GitHub リポジトリの `Settings > Secrets and variables > Actions` に以下を追加します:
   - `VERCEL_TOKEN` - Vercel Personal Token
   - `VERCEL_ORG_ID` - Vercel Organization ID
   - `VERCEL_PROJECT_ID` - Vercel Project ID

4. `main` ブランチへ push すると `.github/workflows/deploy-vercel.yml` がトリガーされ、自動デプロイされます。

注意:
- このリポジトリはサーバ側 API を持つため、Vercel 環境で期待する環境変数（`DATABASE_URL` 等）を `Settings > Environment variables` に設定してください。
- 環境変数は本番用とプレビュー用で分けて管理することを推奨します。
