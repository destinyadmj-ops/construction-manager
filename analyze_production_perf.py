#!/usr/bin/env python3
"""
Production Parameter Tuning & Learning Analysis Script

用途: 本運用中の webhook_bot_v2 の学習状態を分析し、パラメータ調整を提案する。
実行: python3 analyze_production_perf.py

要件:
- VPS の alerting-summary エンドポイントへアクセス可能
- (Optional) 過去の学習状態スナップショットを json で管理
"""

import json
import sys
import time
from datetime import datetime, timezone
from typing import Dict, List, Any
import urllib.request
import urllib.error


LEARNING_SUMMARY_URL = "https://tanaka-bot.org/learning-summary"
HEALTHZ_URL = "https://tanaka-bot.org/healthz"

# アラート別の推奨パラメータ下限/上限
PARAM_BOUNDS = {
    'alert_a': {
        'size_weight': (0.7, 1.4),
        'time_exit_min': (5, 15),
        'partial_tp_r': (1.0, 1.5),
        'atr_k': (1.2, 2.0),
    },
    'alert_b': {
        'size_weight': (0.4, 0.9),
        'time_exit_min': (15, 30),
        'partial_tp_r': (1.5, 2.5),
        'atr_k': (2.0, 3.0),
    },
    'alert_c': {
        'size_weight': (0.8, 1.3),
        'time_exit_min': (4, 10),
        'partial_tp_r': (0.8, 1.2),
        'atr_k': (1.0, 1.8),
    },
    'alert_d': {
        'size_weight': (0.6, 1.1),
        'time_exit_min': (8, 15),
        'partial_tp_r': (0.8, 1.2),
        'atr_k': (1.8, 2.4),
    },
}


def fetch_json(url: str) -> Dict[str, Any]:
    """Fetch JSON from HTTPS endpoint (ignores SSL warnings)."""
    try:
        ctx = urllib.request.ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = urllib.request.ssl.CERT_NONE
        
        with urllib.request.urlopen(url, context=ctx, timeout=10) as response:
            return json.loads(response.read())
    except urllib.error.URLError as e:
        print(f"ERROR fetching {url}: {e}")
        return None
    except Exception as e:
        print(f"ERROR: {e}")
        return None


def analyze_perf() -> None:
    """Main analysis."""
    print("=" * 70)
    print(f"Production Learning Analysis - {datetime.now(timezone.utc).isoformat()}")
    print("=" * 70)
    
    # Check health
    health = fetch_json(HEALTHZ_URL)
    if not health:
        print("FATAL: Cannot reach /healthz. Service may be down.")
        return
    
    print(f"✓ Service Status: {health.get('status')}")
    print(f"✓ Dry Run: {health.get('dry_run')}")
    
    # Fetch learning summary
    summary_data = fetch_json(LEARNING_SUMMARY_URL)
    if not summary_data:
        print("FATAL: Cannot fetch learning-summary.")
        return
    
    summary = summary_data.get('summary', {})
    recent_trades = summary_data.get('recent_trades', [])
    
    print("\n" + "-" * 70)
    print("ALERT PERFORMANCE SUMMARY")
    print("-" * 70)
    
    for alert in ('alert_a', 'alert_b', 'alert_c', 'alert_d'):
        if alert not in summary:
            print(f"{alert.upper()}: NO DATA")
            continue
        
        metrics = summary[alert]
        closed = int(metrics.get('closed', 0))
        wins = int(metrics.get('wins', 0))
        win_rate = float(metrics.get('win_rate', 0.0))
        avg_roi = float(metrics.get('avg_roi', 0.0))
        avg_rr = float(metrics.get('avg_rr', 0.0))
        max_dd = float(metrics.get('max_dd', 0.0))
        weight = float(metrics.get('weight', 1.0))
        
        status = "✓" if win_rate >= 0.5 else "⚠" if win_rate >= 0.3 else "✗"
        
        print(f"\n{alert.upper()} {status}")
        print(f"  Closed: {closed}  |  Wins: {wins}  |  Win Rate: {win_rate:.1%}")
        print(f"  Avg ROI: {avg_roi:+.4%}  |  Avg RR: {avg_rr:.2f}  |  Max DD: {max_dd:.4%}  |  Weight: {weight:.3f}")
        
        # Recommendations
        recommendations = []
        
        if closed >= 5:
            if win_rate < 0.35:
                recommendations.append(f"  ⚡ Low win rate ({win_rate:.1%}): Consider reducing SIZE_WEIGHT or raising TIME_EXIT_ROI_THRESHOLD")
            elif win_rate < 0.50:
                recommendations.append(f"  ⚠  Below 50% WR: Observe 3-5 more trades before major changes")
            elif win_rate >= 0.65:
                recommendations.append(f"  ✓ Strong win rate: Safe to keep current params or slightly increase SIZE_WEIGHT")
            
            if avg_roi > 0:
                if max_dd > 0.05:
                    recommendations.append(f"  ⚡ Max DD {max_dd:.2%} is high: Increase ATR_K or lower SIZE_WEIGHT")
                elif max_dd > 0.02:
                    recommendations.append(f"  ⚠  Max DD {max_dd:.2%}: Monitor and consider modest ATR_K increase")
            
            if avg_rr < 1.0:
                recommendations.append(f"  ⚡ Avg RR {avg_rr:.2f} < 1.0: Targets closing too early; raise TIME_EXIT_MIN or PARTIAL_TP_R")
            elif avg_rr > 2.0:
                recommendations.append(f"  ✓ Strong RR {avg_rr:.2f}: Good risk/reward; maintain")
        else:
            recommendations.append(f"  ℹ  Only {closed} trades: Need {max(3, 5-closed)} more samples for reliable tuning")
        
        if recommendations:
            for rec in recommendations:
                print(rec)
    
    print("\n" + "-" * 70)
    print("RECENT TRADES (LAST 6)")
    print("-" * 70)
    
    for trade in recent_trades[-6:]:
        trade_id = trade.get('trade_id')
        alert = trade.get('alert', '?')
        result = trade.get('result', '?')
        roi = float(trade.get('roi') or 0.0)
        opened_at = trade.get('opened_at', '?')[:16]
        
        result_icon = "✓" if result == "win" else "✗" if result == "loss" else "◯"
        print(f"  {trade_id:3d} | {alert:7s} | {result_icon} {result:4s} | ROI: {roi:+.4%} | {opened_at}")
    
    print("\n" + "-" * 70)
    print("ACTION ITEMS")
    print("-" * 70)
    print("1. Review recommendations above")
    print("2. Edit .env ALERT_*_SIZE_WEIGHT, TIME_EXIT_* params as suggested")
    print("3. Restart webhook_bot_v2.service: systemctl restart webhook_bot_v2.service")
    print("4. Monitor next 5-10 trades before next adjustment")
    print("5. Re-run this script every 4-8 hours during live trading")
    print()


if __name__ == '__main__':
    analyze_perf()
