# 運用点検レポート（2026-03-16）

## 対象質問への判定

### 1) Bitgetとの連携は取れているか
- 判定: **OK（認証と注文成功を確認）**
- 根拠:
  - `GET /api/v2/mix/account/accounts?productType=USDT-FUTURES` で `code:00000` を確認
  - 最小サイズ注文で `code:00000` を確認
- 解釈:
  - APIキー/Secret/Passphrase は有効
  - GET署名実装の不整合は修正済み

### 2) 自動起動・復旧は正常か
- 判定: **正常（自己復旧あり）**
- 根拠:
  - `webhook_bot_v2.service`: `active/running`, `enabled`, `Restart=always`
  - `webhook_bot_healthcheck.timer`: 有効、1分ごとにヘルス確認
  - `/healthz` 異常時は `webhook_bot_v2.service` を再起動する構成

### 3) 本体とエンジンの可動・連携は正常か
- 判定: **正常化済み**
- 根拠:
  - Flask webhook本体、Bitget署名、依存関係、重複検知を修正済み
  - `POST /webhook`（forced action）で正常応答確認済み
  - `POST /webhook`（action未指定）で `status:no_signal` を確認
- 解釈:
  - 以前の import 不整合と timeframe 不整合は解消済み
  - 指標計算エラーはWebhook全体停止につながらないようガード済み

### 4) Bitgetのエントリーまで問題ないか
- 判定: **最小サイズで成功確認済み**
- 根拠:
  - 最小サイズ `0.001` で注文成功レスポンス `code=00000` を確認
  - `same_side_position_exists` による同方向ブロックも実地確認済み
  - テスト後のポジションはクローズ済み
- 現在状態:
  - `DRY_RUN=true` で安全モード稼働中
  - 未決済ポジションは `0`

---

## 現在の公開経路の補足
- `https://tanaka-bot.org/webhook` は 443/TLS 有効化済み
- `https://tanaka-bot.org/healthz` は HTTP 200
- `https://tanaka-bot.org/webhook` への GET は `405`（POST専用として正常）

---

## 現在の安全策
1. `duplicate_request`
   - 同一 `symbol/action/size` の短時間再送をブロック
2. `same_side_position_exists`
   - 同方向ポジション保有中の重複エントリーをブロック
3. `/healthz`
   - `recent_error_count` と `last_runtime_error` を返却
4. `webhook_bot_healthcheck.timer`
   - 1分ごとの自己復旧

---

## 次の実施順（推奨）
1. `DRY_RUN=true` のまま数日監視し、`recent_error_count` とログ安定性を確認
2. 外部送信元から `https://tanaka-bot.org/webhook` へのPOST疎通を確認
3. 実注文時は runbook に従い、最小サイズ1回から段階的に切替

---

## 注記
- APIキー等の秘匿情報が一部テストファイル内に平文で存在していたため、別途ローテーションを推奨。
