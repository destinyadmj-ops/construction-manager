# 自動同期 (git-auto-sync) の常駐化手順

このドキュメントでは、ローカル環境で自動同期スクリプト `scripts/git-auto-sync.ps1` を常駐（定期実行）させる手順を示します。Windows と Linux(systemd) 両方の手順を用意しています。

---

## 前提
- リポジトリをクローン済みであること。
- `scripts/git-auto-sync.ps1` が存在すること（本リポジトリに含まれています）。
- `gh` / `git` の設定（認証）が済んでいること。

---

## Windows: スケジュールタスクで定期実行（推奨）
リポジトリに追加した `scripts/register-git-auto-sync-scheduledtask.ps1` を使用すると簡単に登録できます。
PowerShell を管理者ではなく通常ユーザーで実行し、次を実行してください。

```powershell
# カレントディレクトリをリポジトリ直下にする
cd "C:\path\to\master-hub\scripts"
# 登録（デフォルト 5 分間隔）
pwsh -File .\register-git-auto-sync-scheduledtask.ps1 -IntervalMinutes 5 -TaskName master-hub-git-auto-sync
```

- 登録後、タスクはユーザーのログオン状態に依存して実行されます（`-LogonType Interactive`）。
- 削除する場合:
```powershell
Unregister-ScheduledTask -TaskName master-hub-git-auto-sync -Confirm:$false
```

**注意**: 必要に応じて `-RunLevel` を `Highest` にするか、別ユーザーで実行するなど運用ポリシーに合わせて調整してください。

---

## Linux: systemd タイマー + サービス（例）
1. `/etc/systemd/system/git-auto-sync.service` を作成:

```
[Unit]
Description=Master Hub Git Auto Sync
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/home/youruser/master-hub
ExecStart=/usr/bin/pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File /home/youruser/master-hub/scripts/git-auto-sync.ps1 -Once
User=youruser
```

2. `/etc/systemd/system/git-auto-sync.timer` を作成（5 分間隔）:

```
[Unit]
Description=Run git-auto-sync every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
```

3. 有効化と起動:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now git-auto-sync.timer
```

4. ログ確認:

```bash
journalctl -u git-auto-sync.service -f
```

---

## 動作確認
- スクリプトはローカル変更の自動コミットと push を行います。初回は `git` の設定や push 権限が正しいか注意して確認してください。
- `scripts/git-auto-sync.ps1 -Once` を手動で実行して動作確認してから定期登録することを推奨します。

---

## セキュリティ上の注意
- 自動同期スクリプトはコミット・push を行います。自動で機密ファイルをコミットしないよう `.gitignore` を正しく設定してください。
- 実行ユーザーの SSH 鍵 / Git 認証情報が安全に管理されていることを確認してください。

---

必要なら、私が systemd ユニットファイルテンプレートの調整やスクリプトの non-interactive 設定（ログ出力、ローテーション等）を追加します。