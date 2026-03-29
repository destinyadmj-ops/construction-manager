# Incident Response Playbook（bot障害対応）

## 1) 30秒以内の初動
- サービス状態確認:
  - `systemctl status webhook_bot_v2.service --no-pager -l`
- 直近ログ確認:
  - `journalctl -u webhook_bot_v2.service -n 100 --no-pager`
- ヘルス確認:
  - `curl -s -i http://127.0.0.1:5001/healthz | sed -n '1,20p'`

## 2) 自動復旧の確認
- タイマー状態:
  - `systemctl status webhook_bot_healthcheck.timer --no-pager -l`
- 手動ヘルスチェック実行:
  - `systemctl start webhook_bot_healthcheck.service`
  - `systemctl status webhook_bot_healthcheck.service --no-pager -l`

## 3) 安全側への切戻し
- 即時で実注文を止める:
  - `grep -q '^DRY_RUN=' /home/linuxuser/.bitget_env && sed -i 's/^DRY_RUN=.*/DRY_RUN=true/' /home/linuxuser/.bitget_env || echo 'DRY_RUN=true' >> /home/linuxuser/.bitget_env`
  - `systemctl restart webhook_bot_v2.service`

## 4) 原因別メモ
- `sign signature error`:
  - APIキー不一致、署名対象不一致、時刻ずれを確認
- `ModuleNotFoundError`:
  - `venv` 依存欠落。必要パッケージ追加後に再起動
- `500 on /webhook`:
  - `webhook_bot_v2.py` の例外ログを確認、直前変更差分を戻す
- `duplicate_request`:
  - 同一 `symbol/action/size` が短時間に再送された状態。二重送信や上流不具合を確認
- `same_side_position_exists`:
  - 既に同方向ポジションあり。二重エントリー防止が働いているため、取引所側ポジション確認を優先

## 5) 恒久対策
- 変更は1回1目的で実施
- 反映前に対象ファイルを `.bak_YYYYmmddHHMMSS` 退避
- 反映後に `healthz` / `journalctl` / 最小サイズWebhookの順に検証
