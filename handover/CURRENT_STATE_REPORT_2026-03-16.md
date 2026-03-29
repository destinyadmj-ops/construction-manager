# 現状把握レポート（2026-03-16）

## 1. 稼働の実体（結論）
- 本番稼働サービス: `webhook_bot_v2.service`（`active/running`, `enabled`）
- 停止中サービス: `tradingbot.service`（`inactive/dead`, `disabled`）
- リバースプロキシ: `nginx.service`（`active/running`）
- 公開経路: `tanaka-bot.org/webhook` -> `127.0.0.1:5001/webhook`

## 2. 実行経路
- systemd unit: `/etc/systemd/system/webhook_bot_v2.service`
- 実行ユーザー: `linuxuser`
- WorkingDirectory: `/home/linuxuser`
- ExecStart: `/home/linuxuser/venv/bin/gunicorn -w 2 -b 0.0.0.0:5001 webhook_bot_v2:app`
- 環境変数ファイル: `/home/linuxuser/.bitget_env`

## 3. コード構成の関係
- エントリポイント: `/home/linuxuser/webhook_bot_v2.py`
- `webhook_bot_v2.py` は `bot_v2` 配下モジュール（market/strategy/ai/risk/execution）をimportしている
- したがって、`/home/linuxuser/bot_v2` の修正は本番に影響しうる

## 4. 補助/legacy 系
- `/root/tradingbot` は別系統の旧構成（serviceは現状停止）
- `tradingbot.service` は `EnvironmentFile=/root/.tradingbot_env` へ移行済み（unitへの直書き除去済み）

## 5. 自動起動・定期実行
- bot関連crontabは未設定（root/linuxuserともにbotジョブなし）
- bot起動はsystemd中心

## 6. ランタイム（確認できた範囲）
- Python: `3.10.12`
- pip: `26.0.1`
- packages:
  - Flask `3.1.3`
  - gunicorn `25.1.0`
  - python-dotenv `1.2.1`
  - requests `2.32.5`

## 7. ベースライン（設定ハッシュ）
- `/etc/systemd/system/webhook_bot_v2.service`
  - `03acda3defd69f95580301a57be8ade633f73af3e99af31c40bb2e2cb8b9f515`
- `/etc/systemd/system/tradingbot.service`
  - `36889d7171d9975df4ce0217014d125643988f5a9f5415948322f82627920027`

## 8. 影響を出さない運用ルール（推奨）
1) 変更凍結: まず稼働経路 (`webhook_bot_v2.py`, `bot_v2/*`, `webhook_bot_v2.service`, nginx設定) 以外に触れない
2) 検証分離: `/home/linuxuser/bot_dev` で検証してから本番反映
3) 反映最小化: 1回の変更で1目的（機能追加とリファクタを同時にしない）
4) 監視同時実行: 反映時は `journalctl -u webhook_bot_v2.service -f --no-pager` を追従
5) 即時ロールバック準備: 反映前に対象ファイルを `cp file file.bak_YYYYmmddHHMM` で退避

## 9. 次ステップ（安全順）
- Step A: 本番影響ファイル一覧を固定（Allowlist化）
- Step B: 変更前バックアップ手順をテンプレ化
- Step C: 変更検証チェック（webhook応答/注文処理/ログ異常）をテンプレ化
- Step D: その後に機能追加
