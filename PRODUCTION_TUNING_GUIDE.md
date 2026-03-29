# 本運用・学習周期パラメータ調整ガイド

## 現状

- **mode**: DRY_RUN=false（本運用モード・実注文実行）
- **framework**: 共通ライフサイクル (Hard SL / Structure Exit / Time Exit / Partial TP / Trailing Stop)
- **learning**: per-alert  win_rate / avg_roi / max_dd / weight 自動追跡
- **entry_context**: regime / signal / volatility / liquidity / score / confidence を記録

## フェーズ 1（Week 1-2: データ蓄積）

目標: 各アラート 10-15 トレード程度を蓄積して、win_rate/avg_roi の粗々の像を把握する。

### チェックリスト

```
□ まず 1-2 日間はデフォルトパラメータで運用（一切の手動調整なし）
□ 毎 4-6 時間ごとに /learning-summary で統計を確認
□ Alert 別に closed >= 5 トレード到達した時点で初期分析フェーズへ
□ analyze_production_perf.py を 6 時間おきに実行して推奨値を記録
```

### 監視ポイント

- **win_rate が 30% 未満** → 即座に何か問題

- **max_dd が 5% 超過** → hard_sl が広すぎるか、size が大きすぎる
- **Partial TP が一度も実行されない** → PARTIAL_TP_R_MULTIPLE が高すぎる（1.5 や 1.0 へ低下を試す）
- **Time Exit が頻繁に発火する** → entry_context で確認し、ノイズエントリーの可能性

---

## フェーズ 2（Week 2-3: 初期チューニング）

各アラートが 10+ トレード到達後に、以下の優先度で調整を実施。

### 優先度 1: size_weight（資金配分）

**現在値**: Alert A=1.10, Alert B=0.65, Alert C=1.10, Alert D=0.80

```yaml
調整ルール:
  - 直近 8-12 トレードの win_rate が 65%+ かつ avg_roi > 0.001 
    → SIZE_WEIGHT を +0.15 (max 1.4)
  
  - win_rate が 35% 未満の alert 
    → SIZE_WEIGHT を -0.15 (min 0.5)
  
  - win_rate が 45-55%（中途半端） 
    → 調査フェーズ（まだ SIZE_WEIGHT 変更しない。instead Time Exit パラメータを調べる）
```

### 優先度 2: Time Exit

```yaml
前提:
  - 5分足での Time Exit はトレード周期を決める最重要パラメータ
  - 初期値: A=8分, B=20分, C=6分, D=10分

調整ルール:
  - Partial TP が実行される前に Time Exit で決済される傾向 
    → TIME_EXIT_MIN を +5-10 分上げる
  
  - Time Exit 決済のほとんどが損切り（roi < -0.0005） 
    → TIME_EXIT_MIN を -2-3 分下げる（早期離脱）
  
  - Time Exit してないのに放置されたポジション多数 
    → TRAILING_STOP の調整（Code 側で hard_sl に引っ掛かっているはず）
```

### 優先度 3: Partial TP の発火

```yaml
前提:
  - Partial TP が発火には PARTIAL_TP_R_MULTIPLE を超える R を得る必要
  - 初期値: A=1.2, B=2.0, C=1.0, D=1.0

調整ルール:
  - Partial TP が一度も実行されない 
    → PARTIAL_TP_R_MULTIPLE を -0.3 (e.g., 1.2 → 0.9)
  
  - 大きな利益を Partial で逃がす傾向（10+ R 到達後も割れてしまう） 
    → PARTIAL_TP_RATIO を +0.1 (早めにもっと多く利確)
    または TRAILING_STOP を tighter に（Code 側で自動調整）
```

---

## フェーズ 3（Week 3+: 最適化 & 継続運用）

### 継続的な監視ルーチン

```bash
# 6 時間ごと
python3 analyze_production_perf.py

# 1 日 1 回（深夜推奨）
# - 過去 24h の learning-summary を .json で snapshot として保存
# - 前日比 での win_rate / weight 変化を確認
# - 異常傾向があれば .env パラメータ調整候補リストアップ
```

### 月次の大規模レビュー

```
□ 全 alert の win_rate / max_dd / avg_rr を時系列で可視化
□ Time Decay を確認（古い trades の影響度が正しく減衰しているか）
□ 追加/削除すべき alert がないか検討
□ Market Regime 変化（trend vs range）に対応した weight 自動調整余地がないか
□ Doten 頻度とその成功率を分析
```

---

## トラブルシューティング

### Q: Alert A が勝ちすぎてる
A: win_rate > 75% なら SIZE_WEIGHT +0.2 は安全。ただし max_dd > ３% なら ATR_K を +0.3 上げる。

### Q: Alert B がずっと負ける
A: Trend Following は range 局面で弱い。ENABLE_ORDERBLOCK=true なら OB ロジック追加検討。それまでは SIZE_WEIGHT を 0.5 へ。

### Q: Monitor で Partial TP 実行数 0
A: 学習サマリ recent_trades を見て、Partial TP 前に Time Exit や Hard SL に引っ掛かるパターンを確認。TIME_EXIT_ROI_THRESHOLD を上げるか、PARTIAL_TP_R_MULTIPLE を下げる。

### Q: max_dd が 7% 超えてる
A: 危険信号。即座に SIZE_WEIGHT を -0.2、ATR_K を +0.5 へ調整。次も超える場合、該当 alert の取引を一時停止。

---

## 推奨スケジュール

| 期間 | 主なタスク | 調整リスク |
|------|----------|----------|
| Day 1-2 | デフォルト観測 | 低 |
| Day 3-7 | Alert ごと 10+ トレード蓄積 / win_rate 確認 | 低 |
| Week 2 | 優先度 1-2 調整（size / time_exit） | 中 |
| Week 3+ | Partial TP / Trailing 微調整 | 低 |

---

## .env パラメータリファレンス

```bash
# Alert A (OB+Sweep Sniper)
ALERT_A_SIZE_WEIGHT=1.10              # 資金配分（0.7-1.4）
ALERT_A_TIME_EXIT_MIN=8               # Time Exit 分数（5-15）
ALERT_A_PARTIAL_TP_R_MULTIPLE=1.2     # Partial TP 発火 R 倍数（1.0-1.5）
ALERT_A_ATR_K=1.6                     # Hard SL 幅（1.2-2.0）

# Alert B (Trend Follow)
ALERT_B_SIZE_WEIGHT=0.65              # 資金配分（0.4-0.9）
ALERT_B_TIME_EXIT_MIN=20              # Time Exit 分数（15-30）
ALERT_B_PARTIAL_TP_R_MULTIPLE=2.0     # Partial TP 発火 R 倍数（1.5-2.5）
ALERT_B_ATR_K=2.5                     # Hard SL 幅（2.0-3.0）

# Alert C (Range Rebound)
ALERT_C_SIZE_WEIGHT=1.10              # 資金配分（0.8-1.3）
ALERT_C_TIME_EXIT_MIN=6               # Time Exit 分数（4-10）
ALERT_C_PARTIAL_TP_R_MULTIPLE=1.0     # Partial TP 発火 R 倍数（0.8-1.2）
ALERT_C_ATR_K=1.4                     # Hard SL 幅（1.0-1.8）

# Alert D (Trigger Sniper)
ALERT_D_SIZE_WEIGHT=0.80              # 資金配分（0.6-1.1）
ALERT_D_TIME_EXIT_MIN=10              # Time Exit 分数（8-15）
ALERT_D_PARTIAL_TP_R_MULTIPLE=1.0     # Partial TP 発火 R 倍数（0.8-1.2）
ALERT_D_ATR_K=2.0                     # Hard SL 幅（1.8-2.4）

# Global
MIN_ENTRY_ATR_RATIO=0.0007            # ボラティリティフィルタ（0.0005-0.001）
DOTEN_MIN_SCORE=0.55                  # ドテン精査スコア閾値（0.5-0.7）
```

---

## 次のステップ

1. VPS に `analyze_production_perf.py` をコピー
2. Cron で 6h ごとに実行スケジュール設定
3. Slack/メール通知を `.env` で configure（Optional）
4. 1 週間分の learning-summary snapshot 保管
5. 月末に full review + weight strategy rebalance

---

**初回実行**: `python3 analyze_production_perf.py` → 推奨値を確認 → `.env` 編集 → `systemctl restart webhook_bot_v2.service`
