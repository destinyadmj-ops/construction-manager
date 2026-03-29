# SAFE CHANGE RUNBOOK（本番影響を避ける手順）

## 0) 事前確認（読み取り）
- `powershell -ExecutionPolicy Bypass -File .\verify_prod_remote.ps1`
- `powershell -ExecutionPolicy Bypass -File .\verify_prod_public.ps1`
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "systemctl is-active webhook_bot_v2.service; systemctl is-active nginx"`
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "journalctl -u webhook_bot_v2.service -n 50 --no-pager"`

## 1) バックアップ（変更対象のみ）
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "cp /home/linuxuser/webhook_bot_v2.py /home/linuxuser/webhook_bot_v2.py.bak_$(date +%Y%m%d%H%M)"`
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "tar -czf /root/bot_v2_backup_$(date +%Y%m%d%H%M).tar.gz /home/linuxuser/bot_v2"`

## 2) 変更反映（最小単位）
- 1回の反映で1目的のみ（例: 指標エンジン1つのロジック変更だけ）
- 変更対象は原則:
  - `/home/linuxuser/webhook_bot_v2.py`
  - `/home/linuxuser/bot_v2/*`

## 3) 再起動と即時監視
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "systemctl restart webhook_bot_v2.service"`
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "journalctl -u webhook_bot_v2.service -f --no-pager"`

## 4) 問題時ロールバック
- `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195 "cp /home/linuxuser/webhook_bot_v2.py.bak_YYYYmmddHHMM /home/linuxuser/webhook_bot_v2.py; systemctl restart webhook_bot_v2.service"`
- `bot_v2` 全体を戻す場合はバックアップtarから復元

## 5) 禁止事項（本番安定化期間）
- `nginx` 設定変更とbotロジック変更を同じタイミングで実施しない
- `systemd` unit変更と戦略ロジック変更を同時に実施しない
- シークレット値をunitやソースへ直書きしない
