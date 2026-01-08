# Synology（Container Manager）運用メモ

目的: Synology上で Master Hub（web/worker + Postgres + Redis）を常時稼働。

## 前提

- Synology DSM 7 系
- Container Manager（Docker）が利用可能
- （外部アクセスを安全にする）Tailscale / ZeroTier などのVPNを利用

## セットアップ（最短）

1) リポジトリ配置

- 会社のサーバー/NASに `master-hub/` を配置

2) 環境変数

- `.env.synology.example` をコピーして `.env.synology` を作成
- `ADMIN_TOKEN` などの秘密情報を設定

3) 起動

```bash
docker compose -f docker-compose.synology.yml --env-file .env.synology up -d --build
```

4) 動作確認

- `http://<synology>:3000/api/health` がOK

## 外部アクセス（権限者のみ）

おすすめ: VPN（Tailscale等）で端末を限定する。

iOS/Androidアプリ（WebView）の接続先URLは、次のように「VPN内のHTTPS URL」を使うのが安全。

- 例: `https://<device>.<tailnet>.ts.net/`（TailscaleのHTTPS機能を利用）

これにより、公開インターネットへ露出させずに iOS のATS要件（HTTPS）も満たしやすい。

## DB変更（Prisma）が入る更新

- 更新前にDBバックアップ（pg_dump等）を推奨
- スキーマ変更を含む更新は、更新手順を分けて運用する
