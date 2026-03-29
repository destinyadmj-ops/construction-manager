# 本番運用体制完成レポート（2026-03-17）

## 実装完了サマリー

### 1. コア機能（ユーザー要望実装）

| 機能 | ステータス | 説明 |
|------|----------|------|
| **ドテン（反転取引）** | ✓ 実装・本番検証済み | 反対ポジション検知 → close → open (結果: `doten:true`) |
| **RL学習** | ✓ 実装・永続化対応 | Q-table 自動保存、epsilon 管理 (`/home/linuxuser/bot_v2/data/qtable_live.json`) |
| **Orderblock** | ✓ 実装・signal 統合 | ORDERBLOCK シグナルを generate_signal に追加、boost 設定可能 |
| **Phase45統合** | ✓ 実装・観測中 | micro / arb / RL エンジン、webhook に score 返却 |
| **自動チューニング** | ✓ 構築・ガード有効 | 判定生成のみ（auto_apply_enabled=false で手動承認待ち） |

### 2. 運用自動化（インフラ統合）

| コンポーネント | 実行間隔 | ステータス | 出力 |
|---------------|--------|----------|------|
| **phase45_observe.timer** | 5分 | ✓ active | `/home/linuxuser/bot_v2/data/phase45_observation.log` |
| **phase45_midnight_pipeline.timer** | 毎日 00:00 UTC | ✓ active | summary / decision / report (JSON + Markdown) |
| **health_monitor.timer** | 5分 | ✓ active | `/home/linuxuser/bot_v2/data/health_monitor.log` |
| **emergency_recover.sh** | On-demand / health monitor failure時 | ✓ deployed | Service restart + DRY_RUN safety revert |

### 3. 監視体制（24/7 稼働）

#### 3.1 health_monitor.sh（5分毎）
- **監視対象**: `/healthz` エンドポイント応答
- **チェック項目**:
  - status = "ok"
  - recent_error_count = 0
  - curl 応答性
- **異常時動作**: alert ログ記録 + systemd logger
- **ログ位置**: 
  - Normal: `/home/linuxuser/bot_v2/data/health_monitor.log`
  - Abnormal: `/home/linuxuser/bot_v2/data/health_alert.log`

#### 3.2 emergency_recover.sh（health monitor 失敗時）
- **リトライ戦略**: 最大 3 回、10 秒間隔
- **復旧ロジック**:
  1. health check リトライ失敗
  2. DRY_RUN=true に強制設定（安全最優先）
  3. `systemctl restart webhook_bot_v2.service`
  4. 最終確認
- **ロギング**: systemd journal (`logger -t webhook_bot_emergency`)

### 4. 本番実行環境の状態

```
ホスト: 167.179.65.195 (Vultr VPS)
ドメイン: tanaka-bot.org
Protocol: HTTPS (Let's Encrypt証明書)
Port: 443 (nginx + gunicorn reverse proxy)

Service: webhook_bot_v2.service
Process: gunicorn -w 2 -b 0.0.0.0:5001 webhook_bot_v2:app

Mode: DRY_RUN=false (本番実注文モード)
Health: status=ok, recent_error_count=0
ポジション: [] (フラット)
```

### 5. 過去24時間の動作確認

```
フェーズ 1: 事前確認 ✓
  - Service: active
  - Health: ok
  - Positions: flat

フェーズ 2: DRY_RUN=false 切替 ✓
  - Env var 更新完了
  - Service restart 完了

フェーズ 3: 段階テスト ✓
  - BUY 0.001 BTC: code=00000 ✓
  - SELL (doten): code=00000, doten=true ✓
  - Position flip (long → short): 確認 ✓
  - Flatten: code=00000, positions=[] ✓

フェーズ 4: 本番確認 ✓
  - Health check: status=ok ✓
  - Mode: dry_run=false ✓
  - Errors: 0 ✓
  - Phase45: enabled ✓
```

---

## 運用ガイドライン

### A. 日常監視コマンド

```bash
# リアルタイムヘルスチェック
curl -sS https://tanaka-bot.org/healthz | jq .

# サービスログ（リアルタイム）
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "journalctl -u webhook_bot_v2.service -f"

# 健全性ログ確認
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "tail -f /home/linuxuser/bot_v2/data/health_monitor.log"

# アラートログ確認
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "cat /home/linuxuser/bot_v2/data/health_alert.log"

# Phase45 最新レポート
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "cat /home/linuxuser/bot_v2/data/phase45_daily_report_latest.md"
```

### B. 異常対応フロー

```
┌─ Health Check 失敗？
│  ├─ YES → emergency_recover.sh (自動実行)
│  │         ├─ 3 回リトライ
│  │         ├─ DRY_RUN=true 強制設定
│  │         ├─ Service restart
│  │         └─ 最終確認
│  └─ NO → 正常稼働
│
└─ Manual Intervention が必要？
   ├─ Service 起動しない
   │  → systemctl restart webhook_bot_v2.service
   │  → journalctl で原因調査
   │
   ├─ recent_error_count > 0
   │  → Webhook ログ確認
   │  → /home/linuxuser/bot_v2/execution/trade_executor.py デバッグ
   │
   └─ ポジションが異常状態
      → 手動で close_position() 実行
      → DRY_RUN=true に戻す
      → Service restart
```

### C. 週次チェックリスト

- [ ] Phase45 観測ログが継続的に記録されているか確認
- [ ] Alert log にエントリがないか確認（あれば原因調査）
- [ ] Health monitor.log の uptime % 確認（目標 > 99.5%）
- [ ] Daily report から RL action/micro score の傾向確認
- [ ] `can_apply_now=true` になっていないか確認（tuning 準備完了の場合）

---

## トラブルシューティング

### Q1: healthz が応答しない
```bash
# 1. Service 状態確認
systemctl status webhook_bot_v2.service

# 2. ポート確認 (5001)
netstat -tlnp | grep 5001

# 3. ログ確認
journalctl -u webhook_bot_v2.service -n 50

# 4. 手動再起動
systemctl restart webhook_bot_v2.service
```

### Q2: recent_error_count > 0
```bash
# ログで 最新エラー確認
journalctl -u webhook_bot_v2.service -p 3 -n 20

# Webhook トレース実行（dry_run モード）
curl -X POST https://tanaka-bot.org/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Key: 3f112f8e67295f2134f4f4b00f10f780" \
  -d '{"symbol":"BTCUSDT","action":"get_signal"}' | jq .
```

### Q3: ポジションが異常（long + short 両建てなど）
```bash
# 現在のポジション確認
python3 -c "
import os, json, sys
from pathlib import Path
sys.path.insert(0, '/home/linuxuser')
from bot_v2.execution.bitget_client import BitgetClient
# ... (env load)
client = BitgetClient()
resp = client.request('GET', '/api/v2/mix/position/all-position', {...})
# ... (print positions)
"

# 異常ポジションをクローズ
# → close_position('BTCUSDT', 'sell' for long, 'buy' for short, size)
```

---

## Phase45 自動チューニング（保留中）

現在: `auto_apply_enabled=false` （手動確認待ち）

翌日以降の流れ：

```
2026-03-18 00:00 UTC
  ↓
phase45_midnight_pipeline 実行
  ├─ summarize: 24h 観測集計
  ├─ decide: RL/micro 傾向判定
  │  └─ can_apply_now? 
  │     ├─ false → 記録数不足 (need 200+)
  │     └─ true → 自動提案生成
  └─ report: マークダウンレポート生成
  ↓
決定ジャッジ:
  ├─ 提案値が合理的か？ → YES → apply_tuning 実行
  └─ NO → 現在値維持、サンプル継続
```

自動適用を有効化する場合:
```bash
# .bitget_env に追加
AUTO_APPLY_PHASE45_TUNING=true

# Service restart
systemctl restart webhook_bot_v2.service
```

---

## 本番化完了チェック

- [x] ドテン・RL・orderblock 実装確認
- [x] DRY_RUN=false で実注文テスト完了
- [x] フラット化後の安全状態確保
- [x] 観測ループ（5分）稼働
- [x] 自動判定ループ（00:00 UTC）稼働
- [x] 健全性監視（5分）稼働
- [x] 緊急復旧（on-demand）デプロイ完了
- [x] 本番ドメイン HTTPS 有効
- [x] ポジション 0、エラー 0、状態 OK

---

**Status: 🟢 本番運用開始（2026-03-17 20:53 UTC）**

次のマイルストーン: **2026-03-18 00:00 UTC** - Phase45 24h 初回自動判定
