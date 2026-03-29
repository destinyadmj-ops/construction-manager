from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from urllib import request


BASE_URL = 'http://127.0.0.1:5001'
RUNTIME_DB = '/home/linuxuser/bot_v2/database/runtime_state.db'
REGISTRY_PATH = Path('/home/linuxuser/bot_v2/data/positions.json')
OUTPUT_PATH = Path('/home/linuxuser/watch_profile_partial_btc_alert_b.json')
TARGET_SYMBOL = 'BTCUSDT'
TARGET_STRATEGY = 'alert_b'
TARGET_TP1 = 0.007
CHECKS = 30
INTERVAL_SEC = 60


def fetch_json(url: str):
    req = request.Request(url)
    with request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8'))


def load_registry_open_rows():
    if not REGISTRY_PATH.exists():
        return []
    payload = json.loads(REGISTRY_PATH.read_text(encoding='utf-8'))
    positions = payload.get('positions') if isinstance(payload, dict) else payload
    if not isinstance(positions, list):
        return []
    rows = []
    for row in positions:
        if not isinstance(row, dict):
            continue
        if str(row.get('status') or 'open') != 'open':
            continue
        rows.append({
            'symbol': row.get('symbol'),
            'strategy': row.get('strategy'),
            'size': row.get('size'),
            'entry_context': row.get('entry_context') or {},
            'unrealized_pnl': row.get('unrealized_pnl'),
            'max_profit': row.get('max_profit'),
        })
    return rows


def fetch_monitor_payload() -> dict:
    req = request.Request(
        BASE_URL + '/monitor',
        data=b'{}',
        method='POST',
        headers={'Content-Type': 'application/json'},
    )
    with request.urlopen(req, timeout=40) as resp:
        return json.loads(resp.read().decode('utf-8'))


def load_outcome_counts():
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
    return rows


def main():
    print('WATCH_PROFILE_PARTIAL_START checks=%d interval=%d target=%s/%s tp1=%.4f' % (CHECKS, INTERVAL_SEC, TARGET_SYMBOL, TARGET_STRATEGY, TARGET_TP1), flush=True)
    history = []
    for idx in range(CHECKS):
        health = fetch_json(BASE_URL + '/healthz')
        outcome_rows = load_outcome_counts()
        open_rows = load_registry_open_rows()
        target_rows = [
            row for row in open_rows
            if str(row.get('symbol') or '').upper() == TARGET_SYMBOL and str(row.get('strategy') or '').lower() == TARGET_STRATEGY
        ]
        monitor_payload = None
        monitor_target = None
        monitor_error = None
        try:
            monitor_payload = fetch_monitor_payload()
            for row in (monitor_payload.get('updated') or []):
                if str(row.get('symbol') or '').upper() != TARGET_SYMBOL:
                    continue
                reg = row.get('registry_position') or {}
                if str(reg.get('strategy') or '').lower() != TARGET_STRATEGY:
                    continue
                tp_detail = row.get('tp_detail') or {}
                lifecycle = row.get('lifecycle') or {}
                monitor_target = {
                    'action': row.get('action'),
                    'tp_action': tp_detail.get('action'),
                    'tp_reason': tp_detail.get('reason'),
                    'profile_actions': tp_detail.get('profile_actions') or [],
                    'roi': lifecycle.get('roi'),
                    'lifecycle_action': lifecycle.get('action'),
                    'lifecycle_reason': lifecycle.get('reason'),
                    'monitor_profile_source': row.get('monitor_profile_source'),
                }
                break
        except Exception as exc:
            monitor_error = str(exc)

        snapshot = {
            'idx': idx + 1,
            'dry_run': health.get('dry_run'),
            'runtime_error': health.get('last_runtime_error'),
            'target_open_rows': target_rows,
            'monitor': {
                'skipped': (monitor_payload or {}).get('skipped') if isinstance(monitor_payload, dict) else None,
                'guard': (monitor_payload or {}).get('guard') if isinstance(monitor_payload, dict) else None,
                'target': monitor_target,
                'error': monitor_error,
            },
            'outcomes': outcome_rows,
        }
        history.append(snapshot)
        OUTPUT_PATH.write_text(json.dumps({'checks': CHECKS, 'interval_sec': INTERVAL_SEC, 'target_symbol': TARGET_SYMBOL, 'target_strategy': TARGET_STRATEGY, 'target_tp1': TARGET_TP1, 'history': history}, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({
            'idx': idx + 1,
            'target_open_rows_count': len(target_rows),
            'target_monitor': monitor_target,
            'outcome_rows_count': len(outcome_rows),
            'runtime_error': health.get('last_runtime_error'),
            'webhook_ingress': health.get('webhook_ingress'),
        }, ensure_ascii=False), flush=True)
        if idx < CHECKS - 1:
            time.sleep(INTERVAL_SEC)

    final = {
        'profile_partial_tp_total': 0,
        'partial_tp_total': 0,
        'lifecycle_close_total': 0,
        'trailing_stop_triggered_total': 0,
    }
    latest = history[-1] if history else {}
    for action, _, count, _, _ in latest.get('outcomes') or []:
        if action == 'profile_partial_tp':
            final['profile_partial_tp_total'] += int(count)
        elif action == 'partial_tp':
            final['partial_tp_total'] += int(count)
        elif action == 'lifecycle_close':
            final['lifecycle_close_total'] += int(count)
        elif action == 'trailing_stop_triggered':
            final['trailing_stop_triggered_total'] += int(count)

    print('WATCH_PROFILE_PARTIAL_SUMMARY_START', flush=True)
    print(json.dumps({
        'history_points': len(history),
        'latest': latest,
        'final': final,
    }, ensure_ascii=False, indent=2), flush=True)
    print('WATCH_PROFILE_PARTIAL_SUMMARY_END', flush=True)


if __name__ == '__main__':
    main()
