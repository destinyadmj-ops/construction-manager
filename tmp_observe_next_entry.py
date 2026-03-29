from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from urllib import request

BASE_URL = 'http://127.0.0.1:5001'
HEALTH_URL = BASE_URL + '/healthz'
MONITOR_URL = BASE_URL + '/monitor'
POSITIONS_PATH = Path('/home/linuxuser/bot_v2/data/positions.json')
DB_PATH = '/home/linuxuser/bot_v2/database/runtime_state.db'
REPORT_PATH = Path('/home/linuxuser/next_entry_observation_report.json')

CHECKS = 40
INTERVAL_SECONDS = 30


def fetch_json(url: str, *, method: str = 'GET', payload: dict | None = None) -> dict:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    req = request.Request(url, data=data, method=method, headers=headers)
    with request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))


def load_open_rows() -> list[dict]:
    if not POSITIONS_PATH.exists():
        return []
    payload = json.loads(POSITIONS_PATH.read_text(encoding='utf-8'))
    rows = payload.get('positions') if isinstance(payload, dict) else payload
    open_rows = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if str(row.get('status') or 'open') != 'open':
            continue
        open_rows.append({
            'symbol': row.get('symbol'),
            'strategy': row.get('strategy'),
            'side': row.get('side'),
            'size': row.get('size'),
            'initial_size': row.get('initial_size'),
            'partial_taken': row.get('partial_taken'),
            'timestamp': row.get('timestamp'),
        })
    return open_rows


def load_recent_outcomes(limit: int = 8) -> dict:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute('PRAGMA table_info(monitor_outcome_events)')
    columns = [row[1] for row in cur.fetchall()]
    ts_column = 'event_ts' if 'event_ts' in columns else ('created_at' if 'created_at' in columns else ('updated_at' if 'updated_at' in columns else None))
    roi_column = 'roi' if 'roi' in columns else None
    pnl_column = 'pnl' if 'pnl' in columns else ('realized_pnl' if 'realized_pnl' in columns else None)

    aggregate_parts = ['action', 'alert_name', 'COUNT(1)']
    if roi_column:
        aggregate_parts.append(f'ROUND(AVG({roi_column}), 6)')
    if pnl_column:
        aggregate_parts.append(f'ROUND(SUM({pnl_column}), 6)')
    cur.execute(
        f"SELECT {', '.join(aggregate_parts)} FROM monitor_outcome_events GROUP BY action, alert_name ORDER BY COUNT(1) DESC LIMIT 8"
    )
    top_rows = cur.fetchall()

    recent_rows = []
    if ts_column:
        select_parts = [ts_column, 'action', 'alert_name']
        if roi_column:
            select_parts.append(roi_column)
        if pnl_column:
            select_parts.append(pnl_column)
        cur.execute(
            f"SELECT {', '.join(select_parts)} FROM monitor_outcome_events ORDER BY {ts_column} DESC LIMIT {int(limit)}"
        )
        recent_rows = cur.fetchall()
    conn.close()
    return {
        'columns': columns,
        'top_rows': top_rows,
        'recent_rows': recent_rows,
    }


def main() -> None:
    history: list[dict] = []
    saw_open_positions = False

    print(f'NEXT_ENTRY_OBSERVE_START checks={CHECKS} interval={INTERVAL_SECONDS}', flush=True)
    for index in range(CHECKS):
        ts = int(time.time())
        health = fetch_json(HEALTH_URL)
        monitor = fetch_json(MONITOR_URL, method='POST', payload={})
        open_rows = load_open_rows()
        outcomes = load_recent_outcomes()

        record = {
            'idx': index + 1,
            'ts': ts,
            'dry_run': health.get('dry_run'),
            'runtime_error': health.get('last_runtime_error'),
            'webhook_ingress': health.get('webhook_ingress'),
            'open_rows_count': len(open_rows),
            'open_rows': open_rows,
            'monitor_skipped': monitor.get('skipped'),
            'monitor_guard': monitor.get('guard'),
            'monitor_updated_count': len(monitor.get('updated') or []),
            'monitor_updated': [
                {
                    'symbol': row.get('symbol'),
                    'action': row.get('action'),
                    'strategy': row.get('strategy'),
                    'tp_action': ((row.get('tp_detail') or {}).get('action')),
                    'profile_actions': ((row.get('tp_detail') or {}).get('profile_actions') or []),
                }
                for row in (monitor.get('updated') or [])[:10]
            ],
            'outcome_top_rows': outcomes['top_rows'],
            'recent_outcomes': outcomes['recent_rows'],
        }
        history.append(record)
        REPORT_PATH.write_text(
            json.dumps(
                {
                    'checks': CHECKS,
                    'interval_seconds': INTERVAL_SECONDS,
                    'finished': index == CHECKS - 1,
                    'saw_open_positions': saw_open_positions or bool(open_rows),
                    'latest': record,
                    'history': history,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding='utf-8',
        )

        print(
            json.dumps(
                {
                    'idx': index + 1,
                    'open_rows_count': len(open_rows),
                    'monitor_skipped': monitor.get('skipped'),
                    'monitor_updated_count': len(monitor.get('updated') or []),
                    'latest_outcome': outcomes['recent_rows'][0] if outcomes['recent_rows'] else None,
                },
                ensure_ascii=False,
            ),
            flush=True,
        )

        if open_rows:
            saw_open_positions = True

        if index < CHECKS - 1:
            time.sleep(INTERVAL_SECONDS)

    print('NEXT_ENTRY_OBSERVE_END', flush=True)


if __name__ == '__main__':
    main()