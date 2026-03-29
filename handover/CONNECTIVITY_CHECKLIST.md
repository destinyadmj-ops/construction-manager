# 接続・保存・運用チェックリスト（VS Code Remote-SSH）

## A. 初回接続
- [ ] `Remote - SSH` 拡張がインストール済み
- [ ] `ssh-config.template` を元に `~/.ssh/config` を作成
- [ ] `ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195` でCLI接続できる
- [ ] VS Codeで `Remote-SSH: Connect to Host` できる

## B. 直接編集と保存確認
- [ ] VS Codeでサーバー上のプロジェクトフォルダを開く
- [ ] 任意ファイルを編集して保存
- [ ] サーバー側で `git status` 実行し変更が見える
- [ ] 実行ユーザー権限で書き込み可能

## C. 実行確認
- [ ] 依存関係インストール成功
- [ ] `.env` 配置済み（値は平文共有しない）
- [ ] 起動コマンド成功
- [ ] ログ確認コマンド成功
- [ ] 停止/再起動コマンド成功
- [ ] `GET /healthz` が HTTP 200

## D. 永続化と復旧
- [ ] `systemd` サービス `active (running)`
- [ ] サーバー再起動後に自動起動
- [ ] DBバックアップ取得成功
- [ ] 復旧手順を1回実行確認

## E. セキュリティ
- [ ] 秘密鍵をチャット/ドキュメントに貼っていない
- [ ] `.env` をGitにコミットしていない
- [ ] APIトークン権限を最小化
- [ ] 露出可能性のあるAPIキーをローテーション済み
- [ ] `API_KEY_ROTATION_RUNBOOK.md` に従って差し替え対象ファイルを更新済み
- [ ] 不要ポートを閉じている

## F. 本番切替/障害対応
- [ ] `LIVE_CUTOVER_RUNBOOK.md` に従って段階切替できる
- [ ] `INCIDENT_RESPONSE_PLAYBOOK.md` に従って `DRY_RUN=true` へ即時復帰できる
- [ ] `webhook_bot_healthcheck.timer` が有効
