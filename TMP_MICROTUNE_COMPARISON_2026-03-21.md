# Micro Tuning Comparison 2026-03-21

## Current Observation Snapshot

- 60m source observation status: running
- last_index: 14
- source_counts: position_registry=20
- action_counts: hold=20
- reverse_or_close_events: 0
- recurring monitor candidates:
  - BTCUSDT -> time_decay_exit_25m .. 39m
  - DOGEUSDT -> momentum_kill_volume_drop


## Live One-Trade Captures (Sample 1 & 2)

### Sample 1
- symbol: DOGEUSDT
- strategy: alert_a
- open_order_id: 1419078532524044289
- close_order_id: 1419078615961333761
- monitor_profile_source: position_registry
- tp_action: close
- tp_reason: momentum_kill_volume_drop

| item | size_meta | monitor/runtime | delta |
|---|---:|---:|---:|
| base_size | 10067.90 | 7456.00 | -2611.90 |
| estimated_mark_price | 0.09443 | 0.09444 | 0.00001 |
| target_margin_notional | 13.5816 | 10.0571 | -3.5245 |
| live_balance | 226.36 | - | - |
| effective_margin_ratio | 0.0600 | 0.04443 | -0.01557 |

### Sample 2
- symbol: DOGEUSDT
- strategy: alert_a
- open_order_id: 1419078532524044289
- close_order_id: 1419078615961333761
- monitor_profile_source: position_registry
- tp_action: close
- tp_reason: momentum_kill_volume_drop

| item | size_meta | monitor/runtime | delta |
|---|---:|---:|---:|
| base_size | 10067.90 | 7456.00 | -2611.90 |
| estimated_mark_price | 0.09443 | 0.09444 | 0.00001 |
| target_margin_notional | 13.5816 | 10.0571 | -3.5245 |
| live_balance | 226.36 | - | - |
| effective_margin_ratio | 0.0600 | 0.04443 | -0.01557 |

※2件ともDOGEUSDT・momentum_kill_volume_dropで同一内容（連続捕捉のため）。他シンボルのサンプルが必要。

## Alert B ROI Watch

- samples: 2
- min_roi: 0.008320089343241353
- max_roi: 0.008417450567701762
- avg_roi: 0.008368769955471558

## Current Config vs Candidate

| key | current | candidate | reason |
|---|---:|---:|---|
| ALERT_B_PM_TRAIL_LOW | 0.90 | 0.93 | trailing stop density is high, but loosen only slightly |
| ALERT_B_PM_TRAIL_MID | 0.58 | 0.64 | small-profit exits are too frequent near breakeven |
| ALERT_B_PM_TRAIL_HIGH | 0.36 | 0.40 | keep runners a bit longer without large regime change |
| ALERT_B_TIME_EXIT_MIN | 16 | 16 | hold for now, because current dominant signal is time_decay itself |
| ALERT_B_TIME_EXIT_ROI_THRESHOLD | 0.05 | 0.05 | hold for now until 60m observation finishes |
| MOMENTUM_KILL_ROI_MAX | 0.008 | 0.008 | DOGE close reason matches this gate directly; do not change blindly |
| VOLUME_DROP_THRESHOLD | 0.55 | 0.55 | same reason as above |


## Working Interpretation

1. ライブexit理由はlifecycle（time_decay, momentum_kill）が大半で、profile trailingはほぼ発動していない。
2. BTCUSDTはtime_decay_exit_xxmで繰り返しexit。
3. DOGEUSDTはmomentum_kill_volume_dropで2件連続exit（size_meta/monitor差分も大きい）。
4. profile trailingのチューニングは60m観測完了後に慎重に行うべき。
5. size_meta/monitorの差分はDOGE以外のシンボルでも追加サンプルが必要。

## Recommended Order

1. Let the 60m observation finish and collect the final summary.
2. Capture 2-3 more live trades with the same size_meta/monitor formatter.
3. Revisit momentum_kill/time_decay before deploying the alert_b trailing candidate.
