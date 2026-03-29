from __future__ import annotations

import json
import sqlite3
import subprocess
import time
from pathlib import Path


BASE_URL = 'http://127.0.0.1:5001/monitor'
RUNTIME_DB = '/home/linuxuser/bot_v2/database/runtime_state.db'
OUTPUT_PATH = Path('/home/linuxuser/profile_partial_observation_after_momentum_tune.json')
CHECKS = 30
INTERVAL_SECONDS = 60


def fetch_monitor_payload() -> dict:
    raw = subprocess.check_output(
        ['curl', '-s', '-X', 'POST', BASE_URL, '-H', 'Content-Type: application/json', '-d', '{}'],
        text=True,
    )
    return json.loads(raw)


def fetch_outcome_rows() -> list[dict]:
    conn = sqlite3.connect(RUNTIME_DB)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT action, alert_name, COUNT(1), ROUND(AVG(roi), 6), ROUND(SUM(pnl), 6)
        FROM monitor_outcome_events
        WHERE action IN ('profile_partial_tp', 'partial_tp', 'lifecycle_close', 'trailing_stop_triggered')
        GROUP BY action, alert_name
        ORDER BY action, alert_name
        """
    )
    rows = cur.fetchall()
    conn.close()
    return [
        {
            'action': row[0],
            'alert_name': row[1],
            'count': row[2],
            'avg_roi': row[3],
            'pnl_sum': row[4],
        }
        for row in rows
    ]


def main():
    history = []
    for index in range(1, CHECKS + 1):
        record = {
            'index': index,
            'timestamp': int(time.time()),
            'monitor': None,
            'outcomes': [],
            'error': None,
        }
        try:
            payload = fetch_monitor_payload()
            updated = payload.get('updated') or []
            interesting = []
            for row in updated:
                tp_detail = row.get('tp_detail') or {}
                interesting.append(
                    {
                        'symbol': row.get('symbol'),
                        'bot_name': row.get('bot_name'),
                        'action': row.get('action'),
                        'tp_action': tp_detail.get('action'),
                        'tp_reason': tp_detail.get('reason'),
                        'profile_actions': tp_detail.get('profile_actions') or [],
                    }
                )
            record['monitor'] = {
                'skipped': payload.get('skipped'),
                'guard': payload.get('guard'),
                'updated_count': len(updated),
                'registry_positions_count': len(payload.get('registry_positions') or []),
                'exchange_position_count': payload.get('exchange_position_count'),
                'interesting_rows': interesting,
                'errors': payload.get('errors') or [],
            }
            record['outcomes'] = fetch_outcome_rows()
        except Exception as exc:
            record['error'] = str(exc)

        history.append(record)
        OUTPUT_PATH.write_text(json.dumps({'checks': CHECKS, 'interval_seconds': INTERVAL_SECONDS, 'history': history}, ensure_ascii=False, indent=2), encoding='utf-8')
        if index < CHECKS:
            time.sleep(INTERVAL_SECONDS)


if __name__ == '__main__':
    main()