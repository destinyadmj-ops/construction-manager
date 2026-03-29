# Stabilization Log (2026-03-16)

## 実施した修正（本番サーバー）
- 対象ホスト: `167.179.65.195`
- 対象サービス: `webhook_bot_v2.service`

### 1) 依存不足修正
- `/home/linuxuser/venv` に `numpy` を追加
- 結果: `import webhook_bot_v2` が成功

### 2) Bitget連携の署名修正
- 修正ファイル: `/home/linuxuser/bot_v2/execution/bitget_client.py`
- 修正内容: GET署名時にクエリ文字列を署名対象へ含める
- 検証結果: `code=00000`（account API）

### 3) エントリー実行パス修正
- 修正ファイル: `/home/linuxuser/bot_v2/execution/trade_executor.py`
- 修正内容: 存在しない `order_executor` 参照を廃止し、`order_manager.open_position` へ統一

### 4) Webhook本体の再構成
- 修正ファイル: `/home/linuxuser/webhook_bot_v2.py`
- 追加/変更:
  - `app` を持つFlaskアプリ構造へ統一（gunicorn起動に整合）
  - `GET /healthz` 追加
  - `POST /webhook` で `ticker/symbol`, `action`, `size` を処理
  - `DRY_RUN`（デフォルト true）で実注文抑止
  - 例外時のエラーハンドリングを追加

### 5) 自己復旧機構追加
- 追加ファイル:
  - `/usr/local/bin/webhook_bot_healthcheck.sh`
  - `/etc/systemd/system/webhook_bot_healthcheck.service`
  - `/etc/systemd/system/webhook_bot_healthcheck.timer`
- 動作:
  - 1分ごとに `http://127.0.0.1:5001/healthz` を確認
  - 不健康時は `webhook_bot_v2.service` を再起動

## 実施した検証
- `systemctl restart webhook_bot_v2.service` 実行後、`active (running)` 確認
- `GET /healthz` -> HTTP 200
- `POST /webhook` (forced action) -> HTTP 200 / `status: ok` / `dry_run: true`
- healthcheck service/timer -> 起動成功・timer待機確認

## 追加実施（最小サイズ 本番切替リハーサル）
- `DRY_RUN=false` に一時切替し、`POST /webhook` を最小サイズ `0.001` で1回実行
- 注文APIレスポンス: `code=00000`, `orderId=1417380445577441281` を確認
- 実行後、即時に `DRY_RUN=true` へ戻してサービス再起動済み
- 現在状態: `GET /healthz` で `dry_run:true` を確認

## 恒久化のための追加修正
- `webhook_bot_v2.py` の未対応timeframe `30m` を `15m` へ変更（`TF_MAP` と整合）
- 指標計算（MACDなど）が失敗してもWebhook全体が500で落ちないよう、例外ガードを追加
- `POST /webhook`（action未指定）で `status:no_signal` 応答を確認
- `gunicorn` 複数ワーカーでも効くよう、重複リクエスト検知を SQLite ベースへ変更
- 同方向ポジション保有時の重複エントリーをブロックする判定を追加
- `/healthz` に `recent_error_count` と `last_runtime_error` を追加し、連続例外時は異常化可能な構造へ変更

## 現在の運用ポリシー
- 時間帯制限: なし（構築済みエンジン判断を優先）
- 銘柄: `BTCUSDT`, `ETHUSDT`, `SOLUSDT`
- 回数制限: なし
- 追加安全策: 短時間の同一Webhook再送は `duplicate_request` としてブロック

## 追加検証（same-side / HTTPS）
- `same_side_position_exists` 実地確認:
  - `BTCUSDT` を最小サイズ `0.001` で実注文
  - ポジション保有後、同方向 `buy` を別サイズ `0.002` で再送
  - 結果: `status=blocked`, `reason=same_side_position_exists`
  - その後、テストポジションはクローズ済み。現在の未決済ポジションは `0`
- HTTPS 公開経路:
  - `certbot --nginx` で `tanaka-bot.org` の証明書取得と 443 有効化完了
  - `https://tanaka-bot.org/healthz` -> HTTP 200
  - `https://tanaka-bot.org/webhook` -> GETで HTTP 405（POSTエンドポイントとして正常）

## 現在の運用確認コマンド
- サービス状態
  - `systemctl status webhook_bot_v2.service --no-pager -l`
- ライブログ
  - `journalctl -u webhook_bot_v2.service -f --no-pager`
- ヘルスチェック手動実行
  - `systemctl start webhook_bot_healthcheck.service`
  - `systemctl status webhook_bot_healthcheck.service --no-pager -l`
- タイマー状態
  - `systemctl status webhook_bot_healthcheck.timer --no-pager -l`

## 注意点
- `DRY_RUN=true` のため、現状は安全モード（シグナル処理はするが実注文しない）。
- 実注文に切り替える場合は `.bitget_env` の `DRY_RUN` を `false` にして再起動し、最小サイズで段階検証すること。

## 継続検証（2026-03-17）
- 外部経路の実運用確認:
  - `https://tanaka-bot.org/healthz` -> HTTP 200
  - `https://tanaka-bot.org/webhook` へ `POST {"ticker":"BTCUSDT"}` -> HTTP 200, `{"status":"no_signal","symbol":"BTCUSDT"}`
  - `https://tanaka-bot.org/webhook` へ `POST {"ticker":"ETHUSDT"}` -> HTTP 200, `{"status":"no_signal","symbol":"ETHUSDT"}`
  - `https://tanaka-bot.org/webhook` へ `POST {"ticker":"SOLUSDT"}` -> HTTP 200, `{"status":"no_signal","symbol":"SOLUSDT"}`
- 判定:
  - Cloudflare 経由設定はいったん保留でも、現行の公開経路（DNS only + nginx/TLS）で受信処理は正常
- 保留事項:
  - API キーローテーションの実行は次フェーズへ繰り越し
  - 実施時は `handover/API_KEY_ROTATION_RUNBOOK.md` を使用

## 追加実装（2026-03-17: Phase 4→5 入口）
- サーバー反映先: `/home/linuxuser/bot_v2`
- 追加モジュール:
  - `/home/linuxuser/bot_v2/arbitrage/cross_exchange_arbitrage_engine.py`
  - `/home/linuxuser/bot_v2/microstructure/market_microstructure_engine.py`
  - `/home/linuxuser/bot_v2/reinforcement/reinforcement_learning_trader.py`
- Webhook 統合:
  - `/home/linuxuser/webhook_bot_v2.py` を修復・更新（末尾欠損を解消し、phase45統合コードを追加）
  - バックアップ: `/home/linuxuser/webhook_bot_v2.py.bak_phase45_20260317`
  - 機能フラグ: `ENABLE_PHASE45`（デフォルト `false`）

## 反映後検証（2026-03-17）
- コンパイル確認:
  - `python3 -m py_compile` で Webhook + 追加3モジュールを検証 (`COMPILE_OK`)
- サービス状態:
  - `webhook_bot_v2.service` 再起動後 `active (running)`
- ヘルス確認:
  - `https://tanaka-bot.org/healthz` -> `{"status":"ok","dry_run":true,"phase45_enabled":false,...}`
- Webhook確認:
  - `POST https://tanaka-bot.org/webhook {"ticker":"BTCUSDT"}` -> HTTP 200, `{"status":"no_signal","symbol":"BTCUSDT"}`

## 運用メモ（phase45有効化）
- 既定は安全優先で `ENABLE_PHASE45=false`。
- 有効化する場合のみ `/home/linuxuser/.bitget_env` に `ENABLE_PHASE45=true` を追加し、`systemctl restart webhook_bot_v2.service` を実施。

## Phase45 有効化検証（2026-03-17）
- `ENABLE_PHASE45=true` を設定し、`DRY_RUN=true` を維持して再起動
- `webhook_bot_v2.service` は `active` を確認
- `https://tanaka-bot.org/healthz`:
  - `phase45_enabled=true`
  - `status=ok`, `recent_error_count=0`
- `POST /webhook` (`BTCUSDT`) 応答:
  - HTTP 200
  - `status=no_signal` に加えて `phase45` コンテキスト（`micro`/`arb`/`rl`）を返却
- 補足:
  - 初期実装では `phase45` コンテキストが `None` になるケースがあったため、`_build_phase45_context` をフォールバック返却型に修正済み

## Phase45 段階反映（2026-03-17）
- 目的:
  - 既存シグナルを壊さず、phase45の寄与を小さく開始する
- 実装変更（`/home/linuxuser/webhook_bot_v2.py`）:
  - 固定加算値を環境変数化
    - `PHASE45_MICRO_THRESHOLD`（既定 `0.12`）
    - `PHASE45_MICRO_BOOST`（既定 `0.25`）
    - `PHASE45_RL_BOOST`（既定 `0.15`）
  - `/healthz` に `phase45_config` を追加し、現在値を可視化
- 本番設定（`/home/linuxuser/.bitget_env`）:
  - `ENABLE_PHASE45=true`
  - `DRY_RUN=true`
  - `PHASE45_MICRO_THRESHOLD=0.12`
  - `PHASE45_MICRO_BOOST=0.25`
  - `PHASE45_RL_BOOST=0.15`
- 検証結果:
  - `https://tanaka-bot.org/healthz` で `phase45_config` を確認
  - `POST /webhook` (`BTCUSDT`) は HTTP 200、`phase45` ペイロード返却を継続
  - `recent_error_count=0` を維持

## Phase45 段階調整（2026-03-17 追加）
- 調整内容:
  - `PHASE45_MICRO_BOOST` を `0.25 -> 0.35` に1段引き上げ
  - `DRY_RUN=true` / `ENABLE_PHASE45=true` は維持
- 反映後確認:
  - `webhook_bot_v2.service`: `active`
  - `https://tanaka-bot.org/healthz`:
    - `phase45_config.micro_boost=0.35`
    - `status=ok`, `recent_error_count=0`
  - `POST https://tanaka-bot.org/webhook {"ticker":"BTCUSDT"}`:
    - HTTP 200
    - `status=no_signal` + `phase45` ペイロード返却

## Phase45 段階調整（2026-03-17 追加2）
- 調整内容:
  - `PHASE45_RL_BOOST` を `0.15 -> 0.20` に1段引き上げ
  - `DRY_RUN=true` / `ENABLE_PHASE45=true` / `PHASE45_MICRO_BOOST=0.35` は維持
- 反映後確認:
  - `webhook_bot_v2.service`: `active`
  - `https://tanaka-bot.org/healthz`:
    - `phase45_config.rl_boost=0.2`
    - `status=ok`, `recent_error_count=0`
  - `POST https://tanaka-bot.org/webhook {"ticker":"BTCUSDT"}`:
    - HTTP 200
    - `status=no_signal` + `phase45` ペイロード返却

## 観測フェーズ開始（2026-03-17）
- 24時間観測のため、5分間隔スナップショットを自動記録する timer を追加
  - `/usr/local/bin/phase45_observe.sh`
  - `/etc/systemd/system/phase45_observe.service`
  - `/etc/systemd/system/phase45_observe.timer`
- 記録先:
  - `/home/linuxuser/bot_v2/data/phase45_observation.log`
- 記録内容:
  - `healthz` のJSON（`phase45_config` / `recent_error_count` など）
  - `BTCUSDT` / `ETHUSDT` / `SOLUSDT` への webhook 応答JSON
- 稼働状態:
  - `phase45_observe.timer`: `enabled`, `active`
  - 次回実行が `systemctl list-timers phase45_observe.timer` で確認可能
- 補足:
  - 初回に1件だけ空レコード（`ts:""`）が混入したため、スクリプト引数渡しに修正済み
  - 修正後レコードは `ts/health/webhook` が正常に記録されることを確認

## 観測サマリー自動化（2026-03-17）
- 追加:
  - 集計スクリプト: `/usr/local/bin/phase45_summarize.py`
  - 集計service: `/etc/systemd/system/phase45_summarize.service`
  - 集計timer: `/etc/systemd/system/phase45_summarize.timer`（毎時）
- 出力:
  - `/home/linuxuser/bot_v2/data/phase45_observation_summary_latest.json`
  - `/home/linuxuser/bot_v2/data/phase45_observation_summary_latest.md`
- 稼働確認:
  - `phase45_observe.timer`（5分）と `phase45_summarize.timer`（毎時）がともに有効
- 暫定サマリー（観測初期値）:
  - `records_valid=2`（初期のためサンプル不足）
  - `health_status_counts={'ok': 2}`
  - `webhook_status_counts={'no_signal': 6}`
  - `recent_error_count_max=0`
  - `phase45_micro_score_avg=0.0`
- 現時点の提案:
  - 24時間分（目安 288 レコード）まで現設定を維持し、早期の重み追加変更は見送り

## 重み自動判定フロー追加（2026-03-17）
- 追加スクリプト:
  - 判定生成: `/usr/local/bin/phase45_decide_tuning.py`
  - ガード付き適用: `/usr/local/bin/phase45_apply_tuning.sh`
- 追加systemd:
  - `/etc/systemd/system/phase45_decide_tuning.service`
  - `/etc/systemd/system/phase45_decide_tuning.timer`（毎時）
  - `/etc/systemd/system/phase45_apply_tuning.service`（手動実行用）
- 出力:
  - `/home/linuxuser/bot_v2/data/phase45_tuning_decision_latest.json`
- 安全設計:
  - `AUTO_APPLY_PHASE45_TUNING=false` の間は提案のみ生成し、自動適用しない
  - さらに `records_valid >= 200` かつ `recent_error_count_max == 0` でない限り適用不可
- 初回判定結果:
  - `action=hold`
  - `reasons=["insufficient_records"]`
  - `current/proposed` は `PHASE45_MICRO_BOOST=0.35`, `PHASE45_RL_BOOST=0.2`（据え置き）

## 日次レポート自動化（2026-03-17）
- 追加:
  - レポート生成: `/usr/local/bin/phase45_daily_report.py`
  - レポートservice: `/etc/systemd/system/phase45_daily_report.service`
  - レポートtimer: `/etc/systemd/system/phase45_daily_report.timer`（毎時）
- 出力:
  - `/home/linuxuser/bot_v2/data/phase45_daily_report_latest.md`
- 内容:
  - 現在の運用設定（`DRY_RUN`, `ENABLE_PHASE45`, boosts）
  - 観測サマリーの主要統計
  - 自動判定の最新結果（action/reasons/proposed）
  - 即時運用コマンド（health/decision/apply）
- タイマー構成（phase45系）:
  - `phase45_observe.timer`（5分）
  - `phase45_summarize.timer`（毎日 00:00 UTC）
  - `phase45_decide_tuning.timer`（毎日 00:00 UTC）
  - `phase45_daily_report.timer`（毎日 00:00 UTC）

## スケジュール変更（2026-03-17）
- 要望対応:
  - 自動判定系のトリガーを `00:00` へ統一
- 変更対象:
  - `/etc/systemd/system/phase45_summarize.timer`
  - `/etc/systemd/system/phase45_decide_tuning.timer`
  - `/etc/systemd/system/phase45_daily_report.timer`
- `OnCalendar`:
  - `*-*-* 00:00:00`（UTC）
- 備考:
  - `phase45_observe.timer`（5分観測）は変更なし

## 0:00 実行の順序保証（2026-03-17）
- 背景:
  - `summarize/decide/report` を同時刻timerで動かすと競合順序の余地がある
- 追加:
  - `/usr/local/bin/phase45_midnight_pipeline.sh`
  - `/etc/systemd/system/phase45_midnight_pipeline.service`
  - `/etc/systemd/system/phase45_midnight_pipeline.timer`
- 実行順:
  - `phase45_summarize.py` -> `phase45_decide_tuning.py` -> `phase45_daily_report.py`
- 変更:
  - `phase45_summarize.timer` / `phase45_decide_tuning.timer` / `phase45_daily_report.timer` は停止・無効化
  - 0:00 の定期実行は `phase45_midnight_pipeline.timer` に統合
- 現在のtimer構成:
  - `phase45_observe.timer`（5分）
  - `phase45_midnight_pipeline.timer`（毎日 00:00 UTC）

## 学習・ドテン・orderblock 実装反映（2026-03-17）
- RL永続化:
  - 更新: `/home/linuxuser/bot_v2/reinforcement/reinforcement_learning_trader.py`
  - `q_table` と `epsilon` を JSON 永続化（`save/load` 実装）
  - 保存先: `/home/linuxuser/bot_v2/data/qtable_live.json`
  - 確認: `states=1`, `epsilon` 保存を確認
- orderblock:
  - 追加: `/home/linuxuser/bot_v2/strategy/orderblock_engine.py`
  - Webhookの `generate_signal` に接続し、`ORDERBLOCK` シグナルとして合成
  - 追加設定: `ENABLE_ORDERBLOCK` / `ORDERBLOCK_BOOST`
- ドテン:
  - Webhook 本番経路に反転処理を接続
  - 追加設定: `ENABLE_DOTEN`
  - 反対ポジション保有時:
    - `ENABLE_DOTEN=false` -> `opposite_position_exists_doten_disabled` でブロック
    - `ENABLE_DOTEN=true` -> close→open の反転実行（`DRY_RUN` では実行計画返却）
- 現在の有効フラグ:
  - `ENABLE_DOTEN=true`
  - `ENABLE_ORDERBLOCK=true`
  - `RL_QTABLE_PATH=/home/linuxuser/bot_v2/data/qtable_live.json`
- 検証:
  - `healthz` に `feature_flags`（`doten/orderblock`）を確認
  - `POST /webhook` forced action（`BUY`）で `status=ok`（`DRY_RUN`）を確認

## 運用強化（ログ肥大化対策）
- 追加:
  - `/etc/logrotate.d/phase45_observation`
- 対象:
  - `/home/linuxuser/bot_v2/data/phase45_observation.log`
- ポリシー:
  - 日次ローテーション
  - `rotate 14`（14世代保持）
  - `compress` / `delaycompress`
  - `copytruncate`（観測service継続前提）
- 検証:
  - `logrotate -d /etc/logrotate.d/phase45_observation` で構文・適用条件を確認

## 最終実地検証クローズ（2026-03-17）
- ドテン本番経路の最終確認:
  - `webhook_bot_v2.py` の実行分岐を反転対応へ修正（反対ポジ時 `close -> open`）
  - `POST /webhook` forced action で `result.doten=true` を実確認
  - 応答内 `close` / `open` ともに `code=00000` を確認
- 片付け（フラット化）:
  - 残存 `BTCUSDT long 0.001` をクローズ
  - クローズ実行結果: `code=00000`
  - 最終照会: `POSITIONS_AFTER=[]`（未決済なし）
- 安全復帰:
  - `.bitget_env` を `DRY_RUN=true` に戻し、`webhook_bot_v2.service` 再起動
  - `GET /healthz` で `status=ok`, `dry_run=true`, `feature_flags={doten:true, orderblock:true}` を確認
- 補足:
  - close API の side 指定はこの口座モードでは `long->buy`, `short->sell` で成功することを再確認

## 自動化パイプライン動作確認（2026-03-17）
- 目的:
  - 0:00 UTC の midnight pipeline が正常に稼働しているか実検証
- 実施:
  - `systemctl start phase45_midnight_pipeline.service` で手動実行
  - 実行結果: `code=exited, status=0/SUCCESS`
  - ログ: `summary_written`, `decision_written`, `report_written`, `completed` のすべてを確認
- 出力ファイル確認:
  - `/home/linuxuser/bot_v2/data/phase45_observation_summary_latest.json`:
    - `records_valid=9`（約34分間で採集）
    - `health_status_counts={'ok': 9}`
    - `recent_error_count_max=0`
    - `phase45_rl_action_counts={'buy': 24, 'hold': 3}`
  - `/home/linuxuser/bot_v2/data/phase45_tuning_decision_latest.json`:
    - `action=hold`, `reasons=['insufficient_records']`
    - `auto_apply_enabled=false`（安全に無効化）
    - `current/proposed`: 変更なし（据え置き）
  - `/home/linuxuser/bot_v2/data/phase45_daily_report_latest.md`:
    - レポート生成確認、mode/boosts/RL判定を可視化
    - 即時確認コマンド付属
- タイマー状態:
  - `phase45_observe.timer`: active, 5分毎採集継続
  - `phase45_midnight_pipeline.timer`: active (waiting), 次回 2026-03-17 00:00:00 UTC 実行予約済み
- サービス・ヘルス:
  - `webhook_bot_v2.service`: active (running)
  - `healthz`: status=ok, dry_run=true, feature_flags={doten:true, orderblock:true}
  - `recent_error_count=0`
- 現在のポジション:
  - `POSITIONS=[]`（未決済なし）
- 評価:
  - ✓ パイプライン完全自動化が確認された
  - ✓ 記録採集・判定生成・レポート出力の一連が成功
  - ✓ 次日 00:00 UTC に自動実行される体制が整備完了
  - ✓ 安全ガード（auto_apply_enabled=false）が有効

## 本番モード切替・段階テスト完了（2026-03-17 本番化実施）
- フェーズ 1: 事前確認
  - ✓ サービス状態: active (running)
  - ✓ ヘルス: status=ok, dry_run=true, recent_error_count=0
  - ✓ ポジション確認: POSITIONS=[]（フラット）
- フェーズ 2: 本番切替
  - ✓ DRY_RUN=false へ変更
  - ✓ `webhook_bot_v2.service` 再起動
  - ✓ サービス状態: active (running)
- フェーズ 3: 段階的テスト（最小サイズ 0.001 BTC）
  - BUY テスト:
    - ✓ `POST /webhook {"action":"buy"}` 実行
    - ✓ `code=00000`, `orderId` 返却
    - ✓ ポジション確認: `BTCUSDT long 0.001` 存在
  - SELL（ドテン）テスト:
    - ✓ `POST /webhook {"action":"sell"}` 実行
    - ✓ `doten=true`, close/open ともに `code=00000` 返却
    - ✓ ポジション確認: `BTCUSDT short 0.001` 存在（反転確認）
  - フラット化:
    - ✓ short 0.001 をクローズ
    - ✓ `code=00000` で成功
    - ✓ 最終：POSITIONS=[]（テストポジションは全削除）
- フェーズ 4: 本番運用開始確認
  - ✓ `healthz`: status=ok, dry_run=false
  - ✓ `recent_error_count=0`
  - ✓ `phase45_enabled=true`, `feature_flags={doten:true, orderblock:true}`
  - ✓ `POSITIONS=[]`（未決済なし）
- 総合評価:
  - ✓ ドテン機能が本番環境で完全動作（close→open 反転実行）
  - ✓ orderblock/phase45 統合稼働確認
  - ✓ DRY_RUN=false モードで実注文が正常に処理
  - ✓ 自動化パイプライン（観測/判定/レポート）も並行稼働
  - ✓ サーバーサイド安全ガード（recent_error_count, auto_apply_enabled）有効
  - ✓ 本番運用体制確立完了

## 監視・復旧インフラ整備完了（2026-03-17 20:53 UTC）
- デプロイコンポーネント:
  - `/usr/local/bin/health_monitor.sh` - 5分毎ヘルス確認スクリプト
  - `/usr/local/bin/emergency_recover.sh` - 自動復旧スクリプト（リトライ・DRY_RUN復帰）
  - `/usr/local/bin/monitoring_report.py` - 監視ダッシュボード生成スクリプト
  - `/etc/systemd/system/health_monitor.service` - ヘルス確認 systemd service
  - `/etc/systemd/system/health_monitor.timer` - 5分毎実行タイマー
- 実行状態確認:
  - `health_monitor.timer`: active (waiting), 次回実行 Mon 2026-03-16 20:57:21 UTC
  - `phase45_observe.timer`: active, 5分毎観測継続
  - `phase45_midnight_pipeline.timer`: active, 毎日 00:00 UTC 実行予定
- ログファイル:
  - `/home/linuxuser/bot_v2/data/health_monitor.log` - 5分毎のヘルススナップショット（JSON）
  - `/home/linuxuser/bot_v2/data/health_alert.log` - 異常検知時のアラート記録
  - `/home/linuxuser/bot_v2/data/monitoring_report_latest.md` - 日次監視レポート
- 復旧メカニズム:
  - health check 失敗時の自動リトライ（最大 3 回、10 秒間隔）
  - リトライ失敗時の emergency_recover 発動
  - DRY_RUN=true 自動復帰（安全優先）
  - systemd logger による alert ログ記録
- 検証結果:
  - ✓ health_monitor.sh 初回実行成功
  - ✓ health_monitor.log に JSON レコード記録確認
  - ✓ systemd journal への alert ログ送出確認
  - ✓ emergency_recover.sh デプロイ完了
- 総合状態（最終スナップショット）:
  - Service: active
  - Health: status=ok, dry_run=false, recent_error_count=0
  - Phase45: enabled
  - Positions: [] (フラット)
  - Monitoring: 24/7 稼働（health 5分毎 / observe 5分毎 / pipeline 毎日 00:00 UTC）
