# API Key Rotation Runbook

## 目的
- Bitget API Key / Secret / Passphrase の再発行と差し替えを、安全モードのまま実施する。
- 過去に露出した可能性のある旧キーを失効させ、再検証までを漏れなく行う。

## 前提
- 対象サーバー: `167.179.65.195`
- 対象サービス: `webhook_bot_v2.service`
- 現在モード: `DRY_RUN=true`
- 実環境の鍵ファイル: `/home/linuxuser/.bitget_env`
- 旧legacy系: `/root/.tradingbot_env`

## 1) 先に確認すること
- `webhook_bot_v2.service` が `active (running)` であること
- `https://tanaka-bot.org/healthz` が HTTP 200 であること
- 未決済ポジションが 0 であること

## 2) 人手で必要な作業
- Bitget コンソールで新しい API Key / Secret / Passphrase を発行
- 旧キーは新キー反映後に失効

## 3) 差し替え対象（2026-03-16 時点）
- `/home/linuxuser/.bitget_env`
- `/root/.tradingbot_env`
- `/home/linuxuser/.bitget_env.bak_20260316184538`
- `/home/linuxuser/.bitget_env.bak_20260316190847`
- `/home/linuxuser/bitget.env`
- `/home/linuxuser/bot_v2/test_bitget_connection.py`
- `/home/linuxuser/generate_signature.py`
- `/home/linuxuser/generate_bitget_signature.py`
- `/home/linuxuser/send_webhook.py`
- `/home/linuxuser/send_webhook_fixed.py`

## 4) 安全な反映順
1. サーバー上で現行 env を退避する
2. `/home/linuxuser/.bitget_env` の `BITGET_API_KEY`, `BITGET_API_SECRET`, `BITGET_PASSPHRASE` を新値へ更新する
3. legacy を保持するなら `/root/.tradingbot_env` も同様に更新する
4. バックアップやテストスクリプト内に旧キーが埋まっている場合は、新値へ差し替えるのではなく削除または無害化する
5. `systemctl restart webhook_bot_v2.service` を実行する
6. `DRY_RUN=true` のまま `/healthz` と読み取りAPIで認証確認する
7. 問題なければ旧キーを Bitget コンソールで失効する

## 5) 実行コマンド例
- 退避:
  - `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "cp /home/linuxuser/.bitget_env /home/linuxuser/.bitget_env.rotate_$(date +%Y%m%d%H%M%S)"`
- 再起動:
  - `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "systemctl restart webhook_bot_v2.service"`
- ヘルス確認:
  - `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "curl -s http://127.0.0.1:5001/healthz"`

## 6) 検証項目
- `GET /healthz` が `status: ok`
- Bitget account 読み取り API が `code=00000`
- `journalctl -u webhook_bot_v2.service -n 100 --no-pager` に認証エラーがない
- 外部疎通 `https://tanaka-bot.org/healthz` が HTTP 200

## 7) 実施上の注意
- この環境からは Bitget コンソール操作ができないため、API キーの新規発行と失効は手動作業が前提
- 旧キーが入ったバックアップファイルは、更新ではなく削除を優先する
- 実注文再開は、鍵更新後も `DRY_RUN=true` での検証完了後に行う