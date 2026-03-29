# LIVE CUTOVER RUNBOOK（DRY_RUN -> 実注文）

## 目的
- `DRY_RUN=true` の安全モードから、段階的に実注文モードへ切替する。
- 異常時は即時に `DRY_RUN=true` へ戻して停止影響を最小化する。

## 前提
- 対象サーバー: `167.179.65.195`
- 対象サービス: `webhook_bot_v2.service`
- 環境ファイル: `/home/linuxuser/.bitget_env`
- 監視タイマー: `webhook_bot_healthcheck.timer`

## 0) 事前ヘルス確認
- `powershell -ExecutionPolicy Bypass -File .\verify_prod_remote.ps1`
- `powershell -ExecutionPolicy Bypass -File .\verify_prod_public.ps1`
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "systemctl status webhook_bot_v2.service --no-pager -l | sed -n '1,20p'"`
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "curl -s -i http://127.0.0.1:5001/healthz | sed -n '1,20p'"`
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "systemctl status webhook_bot_healthcheck.timer --no-pager -l | sed -n '1,30p'"`

## 1) 切替前バックアップ
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "cp /home/linuxuser/.bitget_env /home/linuxuser/.bitget_env.bak_$(date +%Y%m%d%H%M%S)"`

## 2) 実注文モードへ切替
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "grep -q '^DRY_RUN=' /home/linuxuser/.bitget_env && sed -i 's/^DRY_RUN=.*/DRY_RUN=false/' /home/linuxuser/.bitget_env || echo 'DRY_RUN=false' >> /home/linuxuser/.bitget_env"`
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "systemctl restart webhook_bot_v2.service"`

## 3) 切替直後の検証（必須）
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "curl -s http://127.0.0.1:5001/healthz"`
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "journalctl -u webhook_bot_v2.service -n 80 --no-pager"`
- 最初の1回は最小サイズ（例: `0.001`）でWebhookを流し、`status=ok` と注文応答を確認する。

## 4) 運用中監視
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "journalctl -u webhook_bot_v2.service -f --no-pager"`
- エラーキーワード監視: `error`, `exception`, `insufficient`, `invalid`, `timeout`

## 5) ロールバック条件（どれか1つでも該当で即時）
- `/healthz` が `200` 以外
- 直近ログに連続例外
- 注文APIレスポンスで認証/署名エラー
- 想定外の連続エントリー

## 6) 即時ロールバック
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "grep -q '^DRY_RUN=' /home/linuxuser/.bitget_env && sed -i 's/^DRY_RUN=.*/DRY_RUN=true/' /home/linuxuser/.bitget_env || echo 'DRY_RUN=true' >> /home/linuxuser/.bitget_env"`
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "systemctl restart webhook_bot_v2.service"`
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "curl -s http://127.0.0.1:5001/healthz"`

## 7) 補足
- HTTPS（443）は開通済み。外部確認は `https://tanaka-bot.org/healthz` と `https://tanaka-bot.org/webhook` を使い、内部確認は `127.0.0.1:5001` を併用する。
- 取引所キー更新後は必ず `DRY_RUN=true` で再検証してから再度本番化する。

## 8) 2026-03-16 実施結果
- 最小サイズ `0.001` で1回の本番リハーサルを実施し、注文成功レスポンス（`code=00000`）を確認。
- リハーサル後は `DRY_RUN=true` へ戻し、`/healthz` で安全モードを確認済み。
