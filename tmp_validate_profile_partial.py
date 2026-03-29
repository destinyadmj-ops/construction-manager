from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from urllib import request


RUNTIME_DB = '/home/linuxuser/bot_v2/database/runtime_state.db'
REGISTRY_JSON = '/home/linuxuser/bot_v2/data/positions.json'
BASE_URL = 'http://127.0.0.1:5001'


def fetch_json(url: str):
    req = request.Request(url)
    with request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8'))


def query_outcomes() -> list[dict]:
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


def load_registry() -> list[dict]:
    path = Path(REGISTRY_JSON)
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding='utf-8'))
    positions = payload.get('positions') if isinstance(payload, dict) else payload
    if not isinstance(positions, list):
        return []
    results = []
    for row in positions:
        if not isinstance(row, dict):
            continue
        if str(row.get('status') or 'open') != 'open':
            continue
        context = dict(row.get('entry_context') or {})
        results.append(
            {
                'symbol': row.get('symbol'),
                'strategy': row.get('strategy'),
                'size': row.get('size'),
                'initial_size': context.get('initial_size'),
                'partial_taken': context.get('partial_taken'),
                'unrealized_pnl': row.get('unrealized_pnl'),
                'max_profit': row.get('max_profit'),
            }
        )
    return results


def main():
    healthz = fetch_json(BASE_URL + '/healthz')
    summary = {
        'dry_run': healthz.get('dry_run'),
        'last_runtime_error': healthz.get('last_runtime_error'),
        'webhook_ingress': healthz.get('webhook_ingress'),
        'outcomes': query_outcomes(),
        'open_registry_positions': load_registry(),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()