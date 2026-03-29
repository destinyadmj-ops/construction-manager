import json
from pathlib import Path

state_path = Path('/home/linuxuser/bot_v2/data/alert_learning_state.json')
state = json.loads(state_path.read_text(encoding='utf-8'))
for trade in reversed(state.get('trades', [])):
    if int(trade.get('trade_id', 0)) == 3 and trade.get('result') == 'open':
        trade['result'] = 'win'
        trade['win'] = True
        trade['roi'] = 0.018
        trade['closed_at'] = 'manual_backfill'
        break

alerts = state.get('alerts', {})
for alert_name, metrics in alerts.items():
    related = [t for t in state.get('trades', []) if t.get('alert') == alert_name and t.get('result') in ('win', 'loss')]
    closed = len(related)
    wins = sum(1 for t in related if t.get('result') == 'win')
    roi_total = sum(float(t.get('roi') or 0.0) for t in related)
    rr_total = sum(float(t.get('rr') or 0.0) for t in related)
    metrics['closed'] = closed
    metrics['wins'] = wins
    metrics['roi_total'] = roi_total
    metrics['rr_total'] = rr_total
    if closed > 0:
        win_rate = wins / closed
        avg_roi = roi_total / closed
        proposed = 0.2 + (win_rate * 0.9) + max(min(avg_roi, 0.2), -0.2)
        metrics['weight'] = float(max(0.2, min(2.0, proposed)))

state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
print('backfilled_trade_3')
