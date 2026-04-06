# VPS Git Operations Runbook

対象ホストは 167.179.65.195、運用リポジトリは /home/linuxuser/repo_from_bundle です。

## 前提

- GitHub の deploy key は設定済みです。
- VPS 側の `origin` は SSH URL を使用します。
- 通常の Git 操作は `linuxuser` 権限で実行します。

## 日常運用コマンド

```bash
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195
cd /home/linuxuser/repo_from_bundle
sudo -u linuxuser git remote -v
sudo -u linuxuser git status --short --branch
sudo -u linuxuser git fetch origin --tags
sudo -u linuxuser git rev-list --left-right --count master...origin/master
```

`rev-list` の出力は `local remote` の順です。`0 5` ならローカルが 5 コミット behind、`3 0` ならローカルに未 push コミットが 3 件あります。

## GitHub から VPS へ取り込む

ローカル変更が無いことを確認してから fast-forward します。

```bash
cd /home/linuxuser/repo_from_bundle
sudo -u linuxuser git fetch origin --tags
sudo -u linuxuser git merge --ff-only origin/master
sudo -u linuxuser git status --short --branch
```

`merge --ff-only` が失敗した場合は、VPS 側でローカル変更や別履歴が発生しています。強制リセットは使わず、差分確認後に別途判断してください。

## VPS から GitHub へ push する

VPS 上でコミットを作成した後は、まず最新を取得して衝突が無いことを確認します。

```bash
cd /home/linuxuser/repo_from_bundle
sudo -u linuxuser git fetch origin --tags
sudo -u linuxuser git status --short --branch
sudo -u linuxuser git push origin master
sudo -u linuxuser git push origin --tags
```

`fetch first` が出た場合は GitHub 側が先行しています。先に `git merge --ff-only origin/master` で同期してから再 push します。

## 変更反映後の本番確認

```bash
systemctl restart webhook_bot_v2.service
systemctl is-active webhook_bot_v2.service
systemctl is-active nginx
curl -sS http://127.0.0.1:5001/healthz
curl -sS https://tanaka-bot.org/healthz
```

期待値は次の通りです。

- `webhook_bot_v2.service` が `active`
- `nginx` が `active`
- 内部 `127.0.0.1:5001/healthz` が JSON を返す
- 外部 `https://tanaka-bot.org/healthz` が HTTP 200 と `status: ok` を返す

## 429 対策の運用メモ

`/healthz` の `decision_stats.exchange_throttle` で API スロットの状態を確認できます。

- `cooldown_remaining_ms`: 現在の取引 API クールダウン残り時間
- `next_allowed_in_ms`: 次の API 実行までの最短待ち時間
- `strike_count`: 連続 429 の段数

429 が連続した場合、アプリは段階的にクールダウンを延長します。調整キーは以下です。

- `EXCHANGE_429_COOLDOWN_SECONDS`
- `EXCHANGE_429_COOLDOWN_MAX_SECONDS`
- `EXCHANGE_429_BACKOFF_MULTIPLIER`
- `EXCHANGE_429_STRIKE_RESET_SECONDS`

設定変更後はサービス再起動が必要です。

## Archive Cleanup Timer

旧クローン archive は one-shot timer で自動削除される設定です。

- Timer unit: `cleanup_repo_archive_20260413.timer`
- Target path: `/home/linuxuser/repo_from_bundle_archive_20260406_0335`
- Scheduled time: `2026-04-13 00:10:00 UTC`

状態確認コマンド:

```bash
systemctl list-timers cleanup_repo_archive_20260413.timer --all --no-pager
systemctl status cleanup_repo_archive_20260413.timer --no-pager
```

削除後の確認コマンド:

```bash
test -d /home/linuxuser/repo_from_bundle_archive_20260406_0335 && echo exists || echo removed
systemctl status cleanup_repo_archive_20260413.service --no-pager
journalctl -u cleanup_repo_archive_20260413.service -n 20 --no-pager
```