# Vultr / Cloudflare / Trading Bot 連携フォーマット

## 1) プロジェクト基本情報
- プロジェクト名: tanaka-bot
- 管理者: 
- 引き継ぎ日: 2026-03-16
- 稼働環境: production

## 2) Vultr サーバー情報
- Instance Label: 
- Region: 
- OS: 
- Public IP: 167.179.65.195
- SSH Port (default 22): 22
- 接続ユーザー: root（現行接続）
- プロジェクト配置先: /root/tradingbot（legacy）, /home/linuxuser（active webhook）
- 実行ユーザー（systemd想定）: linuxuser（webhook_bot_v2.service）

## 3) SSH 連携情報（共有は公開情報のみ）
- SSH Host Alias (`~/.ssh/config`): vultr-trading-prod
- SSH IdentityFile パス（ローカル）: C:\Users\desti\.ssh\id_ed25519_root
- Host key 確認済み: Yes / No
- 鍵認証のみ設定: Yes / No

> 注意: 秘密鍵ファイル本体はこのドキュメントに貼らない。

## 4) Cloudflare 連携情報
- Zone 名: tanaka-bot.org
- 対象ドメイン: tanaka-bot.org
- DNS レコード名: tanaka-bot.org
- Proxy 設定: DNS only（2026-03-16 時点の応答確認ベース）
- API Token 権限: `Zone:Read` / `DNS:Edit` / その他
- Webhook/Workers 使用: Yes / No
- 公開URL: https://tanaka-bot.org/webhook
- ヘルスURL: https://tanaka-bot.org/healthz
- TLS 状態: 2026-03-16 時点で 443 有効、証明書取得済み

## 5) Bot 実行情報
- リポジトリ URL: 
- デフォルトブランチ: 
- 起動コマンド: systemctl start webhook_bot_v2.service
- 停止コマンド: systemctl stop webhook_bot_v2.service
- 再起動コマンド: systemctl restart webhook_bot_v2.service
- ログ確認コマンド: journalctl -u webhook_bot_v2.service -f --no-pager
- ヘルスチェック方法: `curl -s https://tanaka-bot.org/healthz`
- Webhook 疎通確認: `curl -i https://tanaka-bot.org/webhook` は GET で `405 Method Not Allowed` が正常
- 現在モード: `DRY_RUN=true`
- 対応銘柄: `BTCUSDT`, `ETHUSDT`, `SOLUSDT`

## 6) 永続化・データ
- DB 種別: 
- DB ホスト: 
- DB 名: 
- バックアップ方式（dump/snapshot）: 
- バックアップ保存先: 
- リストア手順リンク: 

## 7) systemd（使用時）
- Service 名: webhook_bot_v2.service（active） / tradingbot.service（inactive）
- Unit ファイルパス: /etc/systemd/system/webhook_bot_v2.service, /etc/systemd/system/tradingbot.service
- `WorkingDirectory`: /home/linuxuser
- `ExecStart`: /home/linuxuser/venv/bin/gunicorn -w 2 -b 0.0.0.0:5001 webhook_bot_v2:app
- `EnvironmentFile`: /home/linuxuser/.bitget_env（webhook）, /root/.tradingbot_env（legacy）
- 自動起動有効: Yes（webhook_bot_v2.service）

## 7.1) 監視/自己復旧（追加）
- Healthcheck script: /usr/local/bin/webhook_bot_healthcheck.sh
- Healthcheck service: /etc/systemd/system/webhook_bot_healthcheck.service
- Healthcheck timer: /etc/systemd/system/webhook_bot_healthcheck.timer（1分間隔）
- 復旧動作: `/healthz` 異常時に `webhook_bot_v2.service` を再起動

## 8) 必須シークレット項目（値は `secrets-template.env` で管理）
- `VULTR_API_KEY`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `EXCHANGE_API_KEY`
- `EXCHANGE_API_SECRET`
- `DATABASE_URL`
- `BOT_ENV`

## 9) 引き継ぎチェック
- [x] VS Code Remote-SSH で接続できる
- [x] プロジェクトフォルダを開いて保存反映される
- [x] 依存関係インストール済み
- [x] Bot 起動/停止/再起動コマンドが機能
- [x] systemd 自動起動が機能
- [ ] Cloudflare DNS 更新または参照が可能
- [ ] バックアップ/リストア手順を実行確認済み

## 10) 障害時エスカレーション
- 第1連絡先: 
- 第2連絡先: 
- 監視アラート通知先: 
- 復旧SLO目標: 

## 11) セキュリティ対応メモ
- 2026-03-16: `tradingbot.service` の `Environment=` 直書きを削除し、`EnvironmentFile=/root/.tradingbot_env` へ移行済み。
- 対応要: 過去に露出した可能性のある Exchange API Key / Secret / Passphrase のローテーション実施。
- 実施手順: `API_KEY_ROTATION_RUNBOOK.md` を参照。
