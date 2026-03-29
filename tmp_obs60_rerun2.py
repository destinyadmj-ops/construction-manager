import sys
import time
import json
from collections import Counter, defaultdict
from urllib import request

sys.path.append('/home/linuxuser')
import webhook_bot_v2 as w

symbols = ['HYPEUSDT', 'XRPUSDT', 'SIRENUSDT', 'PEPEUSDT']
checks = 60
interval = 60

eval_agg = {s: {'signal_count': 0, 'no_signal_reason': Counter(), 'blocked': defaultdict(Counter)} for s in symbols}
mon_agg = Counter()
reverse_events = []

print('OBS60_REVERSE_FOCUS_RERUN2_START checks=%d interval=%ds symbols=%s' % (checks, interval, ','.join(symbols)), flush=True)
for i in range(checks):
    ts = int(time.time())
    for s in symbols:
        ev = w._evaluate_bots(s) or {}
        if ev.get('signal'):
            eval_agg[s]['signal_count'] += 1
        ns = ev.get('no_signal_reason') or 'none'
        eval_agg[s]['no_signal_reason'][ns] += 1
        for alert, reason in (ev.get('blocked_reasons') or {}).items():
            eval_agg[s]['blocked'][alert][str(reason)] += 1

    try:
        req = request.Request('http://127.0.0.1:5001/monitor', data=b'', method='POST')
        with request.urlopen(req, timeout=25) as r:
            o = json.loads(r.read().decode('utf-8'))

        skipped = o.get('skipped')
        if skipped:
            mon_agg['skipped:' + str(skipped)] += 1
        guard = o.get('guard') if isinstance(o, dict) else None
        if isinstance(guard, dict):
            reason = guard.get('reason')
            if reason:
                mon_agg['guard_reason:' + str(reason)] += 1

        for u in (o.get('updated') or []):
            act = str(u.get('action') or 'hold')
            mon_agg['action:' + act] += 1
            dm = u.get('doten_mode')
            if dm:
                mon_agg['doten_mode:' + str(dm)] += 1
            if act.startswith('learning_reverse') or 'reverse' in act:
                reverse_events.append({
                    'ts': ts,
                    'symbol': u.get('symbol'),
                    'action': act,
                    'doten_mode': u.get('doten_mode'),
                    'from_alert': u.get('from_alert'),
                    'to_alert': u.get('to_alert'),
                    'reverse_signal': u.get('reverse_signal'),
                })
    except Exception as e:
        mon_agg['monitor_error'] += 1
        mon_agg['monitor_error_last:' + str(e)[:80]] += 1

    print('OBS60_REVERSE_FOCUS_RERUN2_PROGRESS %d/%d' % (i + 1, checks), flush=True)
    if i < checks - 1:
        time.sleep(interval)

print('OBS60_REVERSE_FOCUS_RERUN2_SUMMARY_START', flush=True)
for s in symbols:
    row = eval_agg[s]
    out = {
        'symbol': s,
        'signal_count': row['signal_count'],
        'signal_rate': round(row['signal_count'] / checks, 3),
        'top_no_signal_reason': row['no_signal_reason'].most_common(3),
        'top_blocked': {a: c.most_common(3) for a, c in row['blocked'].items()},
    }
    print(json.dumps(out, ensure_ascii=False), flush=True)
print('OBS60_REVERSE_FOCUS_RERUN2_MONITOR_ACTIONS', json.dumps(mon_agg, ensure_ascii=False), flush=True)
print('OBS60_REVERSE_FOCUS_RERUN2_REVERSE_EVENTS', json.dumps(reverse_events, ensure_ascii=False), flush=True)
print('OBS60_REVERSE_FOCUS_RERUN2_SUMMARY_END', flush=True)
