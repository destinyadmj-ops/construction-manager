# size_meta（5%証拠金計算）と /monitor 詳細 実データ採取（2026-03-20）

## 採取目的
- 実トレード1件で `size_meta`（証拠金比率ベースのサイズ算出）と `/monitor` の実測ポジション詳細を突合。
- 微調整時に見るべき差分（理論サイズ vs 実建玉）を定量化。

## 採取条件
- 実行環境: production (`webhook_bot_v2.service`)
- 対象シンボル: `POLYXUSDT`
- 実施フロー:
  1. `POST /webhook`（`action=BUY`）で実約定を1件発生
  2. 直後に `POST /monitor` を実行して同一シンボル詳細を取得
  3. リスク残し回避のため `POST /webhook`（`action=CLOSE`）でクローズ

## 実データ（抜粋）

### 1) `/webhook` 返却（約定時）
- `status`: `ok`
- `symbol`: `POLYXUSDT`
- `signal`: `BUY`
- `size`: `24203.792005729167`
- `size_meta`:
  - `size_basis`: `margin_pct_5`
  - `entry_margin_balance_pct`: `0.06`
  - `live_balance`: `464.71280651`
  - `target_margin_notional`: `27.8827683906`
  - `target_leverage_for_size`: `40`
  - `estimated_mark_price`: `0.04608`
  - `estimated_base_notional`: `1115.310735624`
  - `estimated_margin_from_size`: `27.8827683906`
  - `leverage.applied`: `true`
  - `leverage.reason`: `symbol_exempt`

### 2) `/monitor` 返却（同一シンボル）
- `symbol`: `POLYXUSDT`
- `side`: `long`
- `size`: `24203.0`
- `entry_price`: `0.046097637485`
- `mark_price`: `0.04613`
- `roi_estimate`: `0.0007020428109906009`
- `stop_price`: `0.045669`
- `trail_ratio`: `0.01`
- `lifecycle.action`: `hold`
- `learning_override.action`: `hold`

## 微調整用 比較表

| 観点 | size_meta（理論/計算値） | /monitor（実測値） | 差分・示唆 |
|---|---:|---:|---|
| 証拠金率 | `entry_margin_balance_pct=0.06` | - | 5%想定より6%設定。環境変数の現設定確認が必要（`ENTRY_MARGIN_BALANCE_PCT=0.06`運用）。 |
| 元本残高 | `live_balance=464.71280651` | - | サイズ算出基礎。残高変動時に比例してサイズ変化。 |
| 目標証拠金 | `target_margin_notional=27.8827683906` | 実測逆算（entry）`27.8925280012364` | `+0.0097596106364`（約 +0.035%）。約定価格差とサイズ丸めの影響。 |
| マーク価格 | `estimated_mark_price=0.04608` | `mark_price=0.04613` | `+0.00005`（約 +0.1085%）。算出時点と監視時点の価格差。 |
| 注文サイズ | `base_size=24203.792005729167` | `size=24203.0` | `-0.792005729167`。取引所の数量ステップ丸め（実建玉は小さめ）。 |
| 想定元本（notional） | `estimated_base_notional=1115.310735624` | 実測（entry）`1115.70112004946` | `+0.39038442546`（約 +0.035%）。価格差由来。 |
| レバレッジ | `target_leverage_for_size=40` | 実測逆算計算でも40前提整合 | `leverage.applied=true` かつ `symbol_exempt`。設定API変更はスキップでも計算は40で一貫。 |

## 1件採取からの調整ポイント
- まずは「5%証拠金」表現を実運用値に合わせて更新（現状は `0.06`）。
- 実建玉は数量ステップで切り下がるため、**最小単位丸め後の有効証拠金率**を監視指標に追加すると再現性が上がる。
- `estimated_mark_price` と実約定時価格のズレは軽微（今回 +0.1% 程度）だが、急変時は誤差増加のため、必要なら価格ソースを約定直前取得に寄せる。

## 採取トランザクション
- Open注文: `orderId=1418646003778220033`（`/webhook`）
- Close注文: `orderId=1418646027044024321`（`/webhook action=CLOSE`）
- learning trade: `trade_id=44` がクローズ済み

---

## 追加採取（連続3件: monitor詳細付き）

### 採取メモ
- `monitor` はガード（`already_running`）に当たる場合があるため、`POST /monitor` を5秒間隔で再試行し、`guard.reason=run` を捕捉して同一シンボル詳細を取得。
- 各銘柄とも `Open -> monitor詳細取得 -> Close` まで実行済み。

### 比較表（3件）

| symbol | base_size(size_meta) | monitor.size | size_delta (monitor-base) | target_margin_notional | entry_margin_from_monitor | margin_delta | est_mark(size_meta) | monitor.mark_price | mark_delta | lifecycle.action |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| DOGEUSDT | 11577.045034977002 | 11577.0 | -0.0450349770017056 | 27.058448507999998 | 27.05255475 | -0.00589375799999559 | 0.09349 | 0.09346 | -0.00003 | hold |
| HYPEUSDT | 27.647336781444768 | 27.64 | -0.00733678144476713 | 27.058448507999998 | 27.0560892500018 | -0.00235925799823988 | 39.148 | 39.156 | 0.008 | hold |
| XRPUSDT | 746.3370158047165 | 746.0 | -0.337015804716543 | 27.058448507999998 | 27.048095 | -0.010353508 | 1.4502 | 1.4497 | -0.0005 | hold |

### 追加採取トランザクション
- DOGEUSDT: Open `1418648874330517505` / Close `1418648968631054337`（`trade_id=53` close）
- HYPEUSDT: Open `1418649030425735169` / Close `1418649083353657346`（`trade_id=54` close）
- XRPUSDT: Open `1418649093508067329` / Close `1418649187833769985`（`trade_id=55` close）

### 追加結果サマリ（微調整向け）
- 3件とも `size_delta < 0` で、実建玉は理論サイズより小さい（数量ステップ丸めの一貫傾向）。
- `entry_margin_from_monitor` は `target_margin_notional` に対して -0.002〜-0.010 USDT の軽微な下振れ。
- `mark_delta` は銘柄により符号が変わるため、監視時刻差による価格ズレが主要因（モデル誤差というより時点差）。
- monitor評価は3件とも `lifecycle.action=hold` で、採取時点の即時Exitトリガーは未発生。

### 連続採取時の補足
- 別バッチで `SIRENUSDT` / `RIVERUSDT` は `leverage_apply_failed`（`40797 Exceeded the maximum settable leverage`）が発生。
- このため連続採取対象は、レバレッジ適用が成功する銘柄（DOGE/HYPE/XRP など）を優先する運用が安定。

---

## 自動集計実行（銘柄別丸め誤差平均・実効証拠金率分布）

### 実行概要
- 実行方式: `Open -> monitor詳細取得（guard run待ち）-> Close` を自動で 5 銘柄実施。
- 対象: `DOGEUSDT`, `HYPEUSDT`, `XRPUSDT`, `POLYXUSDT`, `SOLUSDT`
- 完了: `complete_samples=5 / total_attempts=5`

### 実効証拠金率（overall）
- `effective_margin_ratio_p50 = 0.059992465997999796`（約 5.999%）
- `effective_margin_ratio_p90 = 0.060033594907661296`（約 6.003%）
- `effective_margin_ratio_mean = 0.06000386153044601`（約 6.000%）

### 銘柄ごとの丸め誤差平均（auto集計）

| symbol | samples | rounding_error_avg | rounding_error_abs_avg | effective_margin_ratio_p50 | effective_margin_ratio_p90 |
|---|---:|---:|---:|---:|---:|
| DOGEUSDT | 1 | -0.3843689145778626 | 0.3843689145778626 | 0.060010837354745 | 0.060010837354745 |
| HYPEUSDT | 1 | -0.00034523543527953393 | 0.00034523543527953393 | 0.05997533354355263 | 0.05997533354355263 |
| POLYXUSDT | 1 | -0.9020199826263706 | 0.9020199826263706 | 0.06004876660960549 | 0.06004876660960549 |
| SOLUSDT | 1 | -0.002140972316819756 | 0.002140972316819756 | 0.05999190414632718 | 0.05999190414632718 |
| XRPUSDT | 1 | -0.14357227608081757 | 0.14357227608081757 | 0.059992465997999796 | 0.059992465997999796 |

### 自動集計の要点
- 5銘柄すべてで `rounding_error_avg < 0`（実建玉が理論サイズより小さい）。
- 実効証拠金率は `6%` 設定に対して狭い範囲に収束（p50/p90 ともに 6% 近傍）。

---

## 並行調査: レバレッジ適応の正確性

### 監査方法
- 全 13 銘柄で `target_leverage` 算出後、レバレッジ設定APIを直接検証。
- 失敗銘柄は 2 分探索で「実受理最大レバレッジ」を推定。

### 監査サマリ
- `total_symbols=13`
- `exempt_symbols=1`（POLYXUSDT）
- `ok_target_applied=10`
- `failed_target_apply=2`
- `failed_with_gap=2`

### ギャップ検出結果

| symbol | configured_symbol_cap | target_leverage | apply_result | estimated_max_accepted | gap_vs_target |
|---|---:|---:|---|---:|---:|
| SIRENUSDT | 67 | 40 | 40797 Exceeded maximum settable leverage | 20 | 20 |
| RIVERUSDT | 67 | 40 | 40797 Exceeded maximum settable leverage | 20 | 20 |

### 結論（運用/実装）
- `SIRENUSDT`, `RIVERUSDT` は実受理上限が 20 と推定され、現行の `symbol_cap=67` 想定と乖離。
- 精度観点では、2銘柄のみ `target_leverage` 算出が実取引所制約に不一致（他10銘柄は一致）。
- 修正候補:
  1. `SIRENUSDT` / `RIVERUSDT` の `symbol_cap` を 20 に明示設定
  2. `40797` 発生時に自動フォールバック（例: 20）で再適用してから発注

### 今回の実装反映（repo）
- `webhook_bot_v2.py` を更新し、以下を実装済み。
  - `LEVERAGE_SIREN_MAX` / `LEVERAGE_RIVER_MAX` のデフォルト値を `20` に変更
  - `40797`（最大レバレッジ超過）発生時に `LEVERAGE_40797_FALLBACK`（既定20）で再適用を試行
  - `leverage_meta` に `applied_leverage` を追加し、実適用値を追跡可能化
- 本番反映用差分・`.bitget_env` 推奨値は `handover/PRODUCTION_LEVERAGE_HOTFIX_DIFF_2026-03-20.md` を参照。

### 再検証コマンド（任意）
- 反映後に以下を実行して、`SIRENUSDT`/`RIVERUSDT` が `target<=20` かつ適用成功になることを確認。

```bash
python3 - <<'PY'
import json, sys
sys.path.append('/home/linuxuser')
import webhook_bot_v2 as w
for sym in ['SIRENUSDT','RIVERUSDT']:
    t=int(w._target_leverage(sym, bot_eval=None, atr_ratio=0.0))
    m=w._prepare_entry_leverage(sym, bot_eval=None, atr_ratio=0.0)
    print(json.dumps({'symbol':sym,'target':t,'applied':m.get('applied'),'applied_leverage':m.get('applied_leverage'),'reason':m.get('reason'),'resp':m.get('response')}, ensure_ascii=False))
PY
```
