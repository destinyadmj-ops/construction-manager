# EXIT Distribution Audit (2026-03-20)

## 1) 実施内容
- 本番反映後の健全性確認（SCP → systemd restart → healthz/monitor）を実施。
- 24h 窓の Exit 分布を、以下2系統で監査。
  - `monitor_outcome_events`（新規イベントテーブル）
  - `monitor_outcome_stats` / `/monitor` `outcome_stats.by_bucket`（既存集計）
- `BOT_PROFILES` の `.env` 参照化が本番で有効かを実値確認。
- 過剰最適化対策（学習ウェイト更新ガード）を本番反映。

## 2) 本番状態（最終確認）
- service: `webhook_bot_v2.service` = `active`
- `healthz.status` = `ok`
- `healthz.dry_run` = `false`
- `monitor.status` = `ok`
- `monitor.errors_count` = `0`

## 3) BOT_PROFILES と .env 参照の整合
本番実値で以下を確認済み:
- `ENTRY_STOP_LOSS_PCT=0.08`
- `ROI_TP_STAGE_THRESHOLDS=[0.4,0.8,1.5]`
- `ROI_TP_STAGE_PARTIAL_RATIOS=[0.1,0.15,0.2]`
- `ROI_STOP_LOCK_LEVELS=[0.1,0.3,0.6]`
- `TIME_EXIT_MIN_ROI_DEFAULT=0.05`
- 各 `alert_*` の `type/time_exit/partial` は `.bitget_env` 値でロードされることを確認。

## 4) 24h Exit 分布（取得結果）
### 4.1 `monitor_outcome_events`（新規）
- 24hイベント件数: `0`
- 合計PnL: `0.0`
- 注記: 新規テーブル導入直後のため、母数不足。

### 4.2 `monitor_outcome_stats`（既存集計）
- all-time action集計:
  - `lifecycle_close`: trades=6, roi_sum=-0.0044076897, pnl_sum=-0.0429043381
  - `bot_exit_executed`: trades=2, roi_sum=-0.0019962105, pnl_sum=0.0692469129
- updated_last24h action集計:
  - `lifecycle_close`: trades=6
  - `bot_exit_executed`: trades=2

### 4.3 `/monitor` `outcome_stats.by_bucket` 抜粋
- `bot_exit_executed` / `alert_d` / mixed: trades=1, avg_roi=-0.003817
- `lifecycle_close` / `alert_d` / mixed: trades=3, avg_roi=-0.001623
- `lifecycle_close` / `alert_b` / mixed: trades=1, avg_roi=-0.000098
- `lifecycle_close` / `alert_a` / mixed: trades=1, avg_roi=+0.000119
- `lifecycle_close` / `alert_c` / mixed: trades=1, avg_roi=+0.000440
- `bot_exit_executed` / `alert_a` / mixed: trades=1, avg_roi=+0.001821

## 5) 過剰最適化（過去フィット）対策の反映
### 5.1 実装済み（コード）
`bot_v2/ai/alert_learning_engine.py` の重み更新に以下を追加:
- 最低サンプル数ゲート: `LEARNING_MIN_CLOSED_FOR_WEIGHT`
- 1回更新の最大変化量: `LEARNING_MAX_WEIGHT_STEP`
- 平滑化: `LEARNING_WEIGHT_SMOOTHING_ALPHA`

### 5.2 本番 `.bitget_env` 反映確認
- `LEARNING_MIN_CLOSED_FOR_WEIGHT=20`
- `LEARNING_MAX_WEIGHT_STEP=0.05`
- `LEARNING_WEIGHT_SMOOTHING_ALPHA=0.20`

## 6) 判定
- **交錯リスク（BOT_PROFILES→.env 参照化）**: 現時点で問題なし、維持で妥当。
- **過去データ過適合対策**: 反映済み（コード + 本番env）。
- **Exit分布の統計的十分性**: 新規イベントテーブルはまだ母数不足。24h継続観測が必要。

## 7) 次アクション（推奨）
- 24h後に同監査を再実行し、`monitor_outcome_events`ベースで
  - action比率（structure/trailing/partial/lifecycle/bot_exit）
  - avg_roi / pnl_sum
  - alert別寄与
  を確定する。
- 母数目安: `events >= 30` で初回の分布比較を判断。
