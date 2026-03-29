# PRODUCTION MANIFEST - 本運用開始

**Date**: 2026-03-17  
**Status**: LIVE TRADING ENABLED  
**Time**: 14:32 UTC  
**DRY_RUN**: false  
**Real Order Mode**: ✓ Active  

---

## Current Alert Status

| Alert | Closed | Win Rate | Avg ROI | Weight | Recommendation |
|-------|--------|----------|---------|--------|---|
| A (OB+Sweep) | 4 | 100.0% | +0.055% | 1.10 | ✓ Continue (SIZE_WEIGHT+0.1 monitored) |
| B (Trend) | 2 | 50.0% | +0.0035% | 0.65 | ⚠ Observe (Need 5+ for tuning) |
| C (Rebound) | 1 | 0.0% | -0.027% | 0.20 | ⚠ Watch (1st trade loss, allow 2-3 more) |
| D (Sniper) | 6 | 66.7% | +0.70% | 0.81 | ✓ Accelerate (SIZE_WEIGHT 0.90) |

---

## Configuration

**Core Framework**: Common Lifecycle (Hard SL / Structure Exit / Time Exit / Partial TP / Hybrid Trailing)
**Learning**: Per-alert win_rate / avg_roi / max_dd / weight tracking
**Entry Context**: regime / signal / volatility / liquidity / score / confidence recorded

**Active Parameters** (live in .env):
```
Alert B: TIME_EXIT_MIN 20→18 (increase frequency)
Alert C: SIZE_WEIGHT 0.85 (conservative)
Alert D: SIZE_WEIGHT 0.90 (safety increase)
```

---

## Expected Behavior - Next 7 Days

### Phase: Data Accumulation

**Alert A**: Maintain defaults, monitor for 2-3 more wins
- If all wins continue → SIZE_WEIGHT +0.15 to 1.25 (Week 2)
- If max_dd exceeds 1% → ATR_K +0.2 to 1.8

**Alert B**: Increase entry frequency via TIME_EXIT_MIN reduction
- Target: 5+ closed trades within 48 hours
- Then reassess win_rate for next tuning iteration

**Alert C**: Monitor but do not panic-adjust
- Allow 2-3 additional trades before major changes
- If next 2 are also losses → reduce TIME_EXIT_MIN to 5 min (faster exit)
- If next are wins → weight back up to 1.10

**Alert D**: Safe acceleration phase
- SIZE_WEIGHT 0.90 (was 0.80) provides mild increase
- If win_rate stays 60%+ → SIZE_WEIGHT +0.1 to 1.0 by Week 2
- Monitor max_dd closely (currently 0%, good sign)

---

## Monitoring Checklist

```
✓ 6h Snapshot (cron job on VPS):
  - /home/linuxuser/learning_snapshots/learning_YYYYMMDD_HHMMSS.json
  - Trend tracking for win_rate / weight changes

✓ Daily Manual Review (morning UTC):
  - Fetch /learning-summary, compare vs previous day
  - Identify any alert with win_rate drop > 10%
  - Check if max_dd crossed 2% (yellow flag) or 5% (red flag)

✓ Weekly Comprehensive Analysis (Sunday):
  - Run analyze_production_perf.py on local machine
  - Document any parameter adjustments made and rationale
  - Plan next week's tuning if needed
  
✓ Real-Time Access:
  - /healthz → Service status, recent errors
  - /learning-summary → Full alert metrics
  - /monitor → Active bot decisions, trailing stops, lifecycle state
```

---

## Escalation Protocol

| Condition | Action | Urgency |
|-----------|--------|---------|
| Any alert `max_dd > 5%` | Reduce SIZE_WEIGHT by 0.2 immediately | CRITICAL |
| win_rate < 30% for alert with 5+ trades | Disable entry for that alert (set SIZE_WEIGHT=0) | HIGH |
| Service error rate > ERROR_THRESHOLD | Check webhook logs, restart if needed | HIGH |
| /monitor returns errors | Verify bot lifecycle state, full restart VPS if needed | MEDIUM |

---

## Success Metrics (Week 1)

- [ ] **No max_dd exceeds 2%** (cumulative across all alerts)
- [ ] **Alert A**: Maintain 100% or regress gracefully
- [ ] **Alert B**: Reach 5+ closed trades, assess win_rate
- [ ] **Alert C**: Reach 3+ closed trades (allow 2 more losses)
- [ ] **Alert D**: Keep win_rate 60%+
- [ ] **Portfolio**: Total ROI > 0.05% cumulative
- [ ] **Zero critical errors** in service logs

---

## Next Scheduled Actions

| When | Action | Owner |
|------|--------|-------|
| Every 6h | `snapshot_learning_state.sh` (automated cron) | VPS cron |
| Daily 09:00 UTC | Check /learning-summary, review overnight trades | Manual |
| Daily 21:00 UTC | Backup learning_state.json to local/archive | Manual |
| 2026-03-18 16:00 UTC | First micro-tuning review (Alert B data) | Manual |
| 2026-03-19 16:00 UTC | Second tuning iteration (Alert C data) | Manual |
| 2026-03-24 (Week end) | Comprehensive weekly analysis + planning | Manual |

---

## Rollback Procedure (if needed)

If any alert becomes unstable (win_rate < 25% unexpectedly):

```bash
# On VPS:
1. Disable problematic alert:
  ssh -i C:\Users\desti\.ssh\id_ed25519_root root@167.179.65.195
   vim /home/linuxuser/.bitget_env
   # Set problematic ALERT_X_SIZE_WEIGHT=0

2. Reload webhook:
   systemctl restart webhook_bot_v2.service

3. Verify in /learning-summary that alert now gets 0 new trades

4. Keep learning state intact for post-mortem analysis
```

---

## Documentation

- **Guide**: `/home/linuxuser/PRODUCTION_TUNING_GUIDE.md`
- **Parameters**: `/home/linuxuser/.env.production-live` (current live)
- **Snapshots**: `/home/linuxuser/learning_snapshots/` (6h interval)
- **Service Logs**: `journalctl -u webhook_bot_v2.service -f`

---

## Sign-Off

Production mode is LIVE. All safety checks passed.
Expected cumulative ROI trajectory: +0.05% to +0.20% by Week 2.

**Start Time**: 2026-03-17T14:32:00Z  
**Monitored By**: [User Name]  
**Next Review**: 2026-03-18T09:00:00Z  

---
