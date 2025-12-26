# Tests (Master Hub)

受け入れ条件・テスト観点をここに集約します。

## スモーク
- Web: `/` が表示できる
- API: `/api/health` が 200 を返す

## Schedule
- API: `/api/schedule/week` / `/api/schedule/month` / `/api/schedule/year/summary` が 200 を返す
- API: `/api/schedule/cell` が 400/404 を適切に返し、正常系では 200 を返す
- API: `/api/schedule/assign` は legacy（`cell` の `toggle` と等価）として最低限 200/400/404 の挙動が破綻しない

## Queue/Worker
- Redis稼働時: enqueue が `jobId` を返す
- Redis停止時: enqueue が一定時間で `503` を返す（ハングしない）

## ビルド
- `npm run build` が外部接続エラー（例: Redis）無しで完走する

## E2E
- Playwright: `e2e/smoke.spec.ts` が成功する
