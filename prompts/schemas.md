# Schemas (Master Hub)

このドキュメントは「画面/API/データ」のスキーマ草案をまとめます。

## データモデル（Prisma）
- User
- CalendarEvent
- WorkEntry
- IntegrationAccount

（詳細は `prisma/schema.prisma` を正とする）

## API（現状）
- `GET /api/health`
- `GET /api/accounting/ping`
- `POST /api/queue/reminders/enqueue`

## スケジュール（現状）
- `GET /api/schedule/week`
- `GET /api/schedule/month`
- `GET /api/schedule/year/summary`
- `GET /api/schedule/sites`
- `POST /api/schedule/assign`（legacy: `cell` の `toggle` エイリアス）
- `POST /api/schedule/auto-fill`
- `POST /api/schedule/cell`（セル操作: トグル/追加/削除/入替/2枠目置換）

### 表示ルール（週/月）
- 1セルは **最大2枠** 表示（開始時刻順の上位2件）
- 3件以上ある場合は 2枠目に `+N` を付けて省略（例: `現場B +3`）

### 操作ルール（週/月のセルクリック）
- `toggle`: 選択現場があれば削除 / なければ追加（**満杯なら2枠目を置換**）
- `add`: 空きがあるときだけ追加（満杯なら変更しない）
- `replace2`: 2枠目を置換（空きなら追加）
- `remove`: 選択現場を削除
- `swap`: 1枠目と2枠目を入替（選択現場なしで実行可）

## 追加予定（未確定）
- 予定CRUD
- 作業CRUD
- 連携設定CRUD
