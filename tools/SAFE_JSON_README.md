使い方: safe_json ログ受信（開発向け）

概要
- `tools/safe_json_receiver.py` は `safe_json` が送る型ログを受け取り、`logs/safe_json_remote.log` に追記する簡易受信サーバです。
- 本番向けではなく開発時の可視化用です。短時間の検証に使ってください。

起動
1. 依存をインストール:

   python -m pip install -r requirements.txt

2. 受信サーバを起動（デフォルト: ポート8000）:

   python tools/safe_json_receiver.py

認証
- 環境変数 `SAFE_JSON_RECEIVER_TOKEN` を設定すると、受信時に `X-Auth-Token` ヘッダかクエリ `?token=` を要求します。
- 例: `export SAFE_JSON_RECEIVER_TOKEN=secret` しておく。

接続例
- `bot_v2/main.py` の `SAFE_JSON_LOG_ENDPOINT` に以下を設定してください（ローカル）:

  http://localhost:8000/

- 受信が認証を必要とする場合、`SAFE_JSON_LOG_ENDPOINT` を使う代わりに `SLACK_WEBHOOK_URL` を環境変数に設定して Slack に流すこともできます。

ログ確認
- 受信したペイロードは `logs/safe_json_remote.log` に JSONL 形式で追記されます。

注意点
- これは開発用です。本番に展開する場合は TLS、認証強化、レート制限、ログ保護を必ず実装してください。
