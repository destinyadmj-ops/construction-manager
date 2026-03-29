from __future__ import annotations

import json
import time
from collections import Counter, defaultdict
from pathlib import Path
from urllib import request

BASE_URL = 'http://127.0.0.1:5001/monitor'
OUTPUT_PATH = Path('/home/linuxuser/obs60_profile_source_latest.json')
CHECKS = 60
INTERVAL_SECONDS = 60


def fetch_monitor_payload() -> dict:
    req = request.Request(BASE_URL, data=b'{}', method='POST', headers={'Content-Type': 'application/json'})
    with request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))


def main() -> None:
    source_counts = Counter()
    source_by_symbol = defaultdict(Counter)
    action_counts = Counter()
    reverse_events = []
    errors = []
    history = []

    for index in range(1, CHECKS + 1):
        ts = int(time.time())
        snapshot = {
            'index': index,
            'timestamp': ts,
            'skipped': None,
            'guard': None,
            'updated_count': 0,
            'interesting_rows': [],
            'errors': [],
        }
        try:
            payload = fetch_monitor_payload()
            snapshot['skipped'] = payload.get('skipped')
            snapshot['guard'] = payload.get('guard')
            updated = payload.get('updated') or []
            snapshot['updated_count'] = len(updated)
            snapshot['errors'] = payload.get('errors') or []
            for row in updated:
                sym = str(row.get('symbol') or 'UNKNOWN')
                src = str(row.get('monitor_profile_source') or 'none')
                act = str(row.get('action') or 'hold')
                tp = row.get('tp_detail') or {}
                source_counts[src] += 1
                source_by_symbol[sym][src] += 1
                action_counts[act] += 1
                if act.startswith('learning_reverse') or 'reverse' in act or act.startswith('close'):
                    reverse_events.append({
                        'ts': ts,
                        'symbol': sym,
                        'source': src,
                        'action': act,
                        'from_alert': row.get('from_alert'),
                        'to_alert': row.get('to_alert'),
                        'reverse_signal': row.get('reverse_signal'),
                        'tp_action': tp.get('action'),
                        'tp_reason': tp.get('reason'),
                    })
                if act != 'hold' or tp.get('action') not in (None, 'hold'):
                    snapshot['interesting_rows'].append({
                        'symbol': sym,
                        'source': src,
                        'action': act,
                        'tp_action': tp.get('action'),
                        'tp_reason': tp.get('reason'),
                        'profile_actions': tp.get('profile_actions') or [],
                    })
        except Exception as exc:
            errors.append({'ts': ts, 'error': str(exc)[:200]})
            snapshot['errors'].append(str(exc)[:200])

        history.append(snapshot)
        OUTPUT_PATH.write_text(
            json.dumps(
                {
                    'checks': CHECKS,
                    'interval_seconds': INTERVAL_SECONDS,
                    'finished': index >= CHECKS,
                    'last_index': index,
                    'source_counts': dict(source_counts),
                    'action_counts': dict(action_counts),
                    'reverse_or_close_events': reverse_events,
                    'error_count': len(errors),
                    'errors_tail': errors[-10:],
                    'source_by_symbol': {k: dict(v) for k, v in source_by_symbol.items()},
                    'history_tail': history[-10:],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding='utf-8',
        )
        if index < CHECKS:
            time.sleep(INTERVAL_SECONDS)


if __name__ == '__main__':
    main()
