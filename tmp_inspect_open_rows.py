from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from urllib import request

HEALTH_URL = 'http://127.0.0.1:5001/healthz'
POSITIONS_PATH = Path('/home/linuxuser/bot_v2/data/positions.json')
DB_PATH = '/home/linuxuser/bot_v2/database/runtime_state.db'


def fetch_json(url: str):
    req = request.Request(url)
    with request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8'))


def main():
    health = fetch_json(HEALTH_URL)
    positions_payload = json.loads(POSITIONS_PATH.read_text(encoding='utf-8')) if POSITIONS_PATH.exists() else {}
    rows = positions_payload.get('positions') if isinstance(positions_payload, dict) else positions_payload
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
            'timestamp': row.get('timestamp'),
            'entry_context': row.get('entry_context') or {},
            'max_profit': row.get('max_profit'),
            'unrealized_pnl': row.get('unrealized_pnl'),
        })

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(monitor_outcome_events)")
    outcome_columns = [row[1] for row in cur.fetchall()]
    ts_column = 'event_ts' if 'event_ts' in outcome_columns else ('created_at' if 'created_at' in outcome_columns else ('updated_at' if 'updated_at' in outcome_columns else None))
    roi_column = 'roi' if 'roi' in outcome_columns else None
    pnl_column = 'pnl' if 'pnl' in outcome_columns else ('realized_pnl' if 'realized_pnl' in outcome_columns else None)
    reason_column = 'reason' if 'reason' in outcome_columns else None
    position_state_column = 'position_state' if 'position_state' in outcome_columns else None

    aggregate_parts = ['action', 'alert_name', 'COUNT(1)']
    if roi_column:
        aggregate_parts.append(f'ROUND(AVG({roi_column}), 6)')
    if pnl_column:
        aggregate_parts.append(f'ROUND(SUM({pnl_column}), 6)')
    aggregate_query = f"SELECT {', '.join(aggregate_parts)} FROM monitor_outcome_events GROUP BY action, alert_name ORDER BY COUNT(1) DESC LIMIT 20"
    cur.execute(aggregate_query)
    top_outcomes = cur.fetchall()

    recent_outcomes = []
    if ts_column and roi_column and pnl_column:
        select_parts = [ts_column, 'action', 'alert_name', roi_column, pnl_column]
        if position_state_column:
            select_parts.append(position_state_column)
        if reason_column:
            select_parts.append(reason_column)
        query = f"SELECT {', '.join(select_parts)} FROM monitor_outcome_events ORDER BY {ts_column} DESC LIMIT 15"
        cur.execute(query)
        recent_outcomes = cur.fetchall()
    conn.close()

    print(json.dumps({
        'dry_run': health.get('dry_run'),
        'webhook_ingress': health.get('webhook_ingress'),
        'open_rows': open_rows,
        'outcome_columns': outcome_columns,
        'top_outcomes': top_outcomes,
        'recent_outcomes': recent_outcomes,
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
