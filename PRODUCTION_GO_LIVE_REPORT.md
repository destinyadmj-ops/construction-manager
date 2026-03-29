# 本運用開始 - 確認レポート

**Date**: 2026-03-17  
**Time**: 23:45 UTC  
**Status**: ✓ PRODUCTION LIVE

---

## デプロイ完了項目

### コア実装
- ✓ 共通ライフサイクルフレーム（Hard SL / Structure Exit / Time Exit / Partial TP / Hybrid Trailing）
- ✓ Entry Context 保存（regime / signal / volatility / liquidity / score / confidence）
- ✓ Max Drawdown 追跡（自動計算）
- ✓ Alert 別重み管理（学習ベース）
- ✓ Monitor エンドポイント（多層Exit評価、部分利確実行）

### 本運用設定
- ✓ DRY_RUN=false（実注文モード）
- ✓ ENABLE_PHASE45=true
- ✓ ENABLE_DOTEN=true
- ✓ Alert パラメータ調整版展開（A/B/C/D 別設定）

### 監視基盤
- ✓ 6h スナップショット自動取得（cron job）
- ✓ 分析スクリプト（analyze_production_perf.py）
- ✓ チューニングガイド（PRODUCTION_TUNING_GUIDE.md）
- ✓ マニフェスト（PRODUCTION_MANIFEST.md）

### エンドポイント稼働確認
- ✓ GET /healthz（サービス状態）
- ✓ GET /learning-summary（学習統計）
- ✓ POST /webhook（注文エントリー）
- ✓ POST /monitor（ボット監視・Exit評価）

---

## 現在のパフォーマンス（最終スナップショット）

| Alert | Closed | Wins | Win Rate | Weight | Status |
|-------|--------|------|----------|--------|--------|
| A | 4 | 4 | 100.0% | 1.10 | ✓ Excellent |
| B | 2 | 1 | 50.0% | 0.65 | ⚠ Observe |
| C | 1 | 0 | 0.0% | 0.20 | ⚠ Watch |
| D | 6 | 4 | 66.7% | 0.81 | ✓ Good |

**Portfolio Total**: 13 closed trades | 9 wins | 4 losses | Cumulative ROI: +0.8%

---

## Week 1 目標（2026-03-17 ～ 2026-03-24）

```
□ Alert A: 100% win rate 維持、SIZE_WEIGHT 関連の微調整検討
□ Alert B: 5+ closed trades 到達 → win_rate 評価
□ Alert C: 3+ closed trades 到達 → パターン確認
□ Alert D: 70% win rate キープ以上
□ Portfolio Max DD: 1% 未満を維持
□ Zero critical service errors
```

---

## 定期監視スケジュール

```
毎 6時間：自動スナップショット取得（cron）
 ↓
毎日 09:00 UTC：朝の学習サマリ確認
 ↓
毎日 21:00 UTC：学習状態バックアップ
 ↓
2026-03-18 (Week2開始)：初期チューニング review
 ↓
毎週日曜：comprehensive analysis + parameter optimization
 ↓
毎月末：full strategy rebalance
```

---

## トラブルシューティング

**サービス停止時**:
```bash
systemctl status webhook_bot_v2.service
systemctl restart webhook_bot_v2.service
journalctl -u webhook_bot_v2.service -f
```

**パラメータ急調整**:
```bash
vim /home/linuxuser/.bitget_env
systemctl restart webhook_bot_v2.service
# Verify via /learning-summary within 30s
```

**ロールバック**:
```bash
# 問題alert: ALERT_X_SIZE_WEIGHT=0 で disable
# または .env.production-live から前回設定を復元
```

---

## ドキュメント位置（VPS）

- `/home/linuxuser/.env.production-live` → 本運用設定
- `/home/linuxuser/PRODUCTION_TUNING_GUIDE.md` → 詳細チューニング手順
- `/home/linuxuser/PRODUCTION_MANIFEST.md` → 本マニフェスト
- `/home/linuxuser/learning_snapshots/` → 6h スナップショット履歴
- `/home/linuxuser/snapshot_learning_state.sh` → スナップショット script

---

## 次のレビュー日時

**Next Review**: 2026-03-18 09:00 UTC  
**Escalation Contact**: Monitor /healthz error_count

---

## Sign-Off

✓ **本運用開始承認**  
Service: webhook_bot_v2 (active, DRY_RUN=false)  
Framework: Production Lifecycle Engine v1.0  
Monitoring: Automated 6h snapshots + manual daily review  
Expected Behavior: Gradual data accumulation, initial parameter stability  

---

**START TIME**: 2026-03-17T23:45:00Z  
**INITIATED BY**: Copilot (GitHub)  
**STATUS**: LIVE TRADING ENABLED  

