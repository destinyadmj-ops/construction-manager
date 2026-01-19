# Requirements (Master Hub)

このドキュメントは「プロンプトを入れる前に」プロジェクトの前提・要件を固定するための土台です。

## 目的
- PC主体 + スマホ(PWA)連携を前提にした、カレンダーベースの予定・業務ハブを提供する

## 対象ユーザー
- 個人/小規模チーム（まずは1ユーザー想定）

## スコープ（初期）
- 予定（CalendarEvent）
- 作業記録（WorkEntry）
- 外部連携アカウント（IntegrationAccount）
- バックグラウンド処理（BullMQ: reminders）

## 作業予定（WorkEntry）UI（現状方針）
- 週/月/年のハブ画面で作業予定を一覧する
- 1セル（従業員×日）には **最大2枠**（2行）で表示し、3件以上は `+N` 表記で省略する
- 従業員数が多い前提で **行はできるだけ狭く**（セル内に常時ボタンを増やさない）
- セルクリックの動作（トグル/追加/削除/入替/2枠目置換）は **固定バーで切替**して操作する

## 非スコープ（初期）
- 権限/組織/複雑なロール管理
- 課金

## 非機能要件
- **ビルド時に外部依存へ接続しない**（例: Redis/DBへの接続は起動時・実行時のみ）
- ローカル開発は Docker (Postgres/Redis) で再現可能

## 環境・前提
- タイムゾーン: （未確定なら `Asia/Tokyo` を仮採用）
- 休日/営業日: （未確定）
- 締め日/集計: （未確定）

## 受け入れ条件（最小）
- `npm run lint` / `npm run typecheck` / `npm run build` が成功する
- `npm run e2e`（Playwright smoke）が成功する
- Dockerで `npm run docker:up` 後、Prisma migrate が適用できる
- `POST /api/queue/reminders/enqueue` が Redis 稼働時にジョブ投入でき、Redis停止時はハングせず `503` を返す
