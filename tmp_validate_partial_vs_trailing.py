from __future__ import annotations

import json
import time
from pathlib import Path
from urllib import request


BASE_URL = 'http://127.0.0.1:5001'
SYMBOL = 'DOGEUSDT'
ALERT_NAME = 'alert_c'
SIDE_ACTION = 'BUY'
POSITIONS_PATH = Path('/home/linuxuser/bot_v2/data/positions.json')
REPORT_PATH = Path('/home/linuxuser/partial_vs_trailing_report.json')
MAX_POLLS = 40
POLL_SECONDS = 30
POLL_SECONDS = 30
STOP_ACTIONS = {
    'profile_partial_tp',
    'partial_tp',
    'trailing_stop_triggered',
    'lifecycle_close',
    'close',
}


def req(path: str, method: str = 'GET', payload: dict | None = None, timeout: int = 40) -> dict:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    http_request = request.Request(BASE_URL + path, data=data, method=method, headers=headers)
    with request.urlopen(http_request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def load_registry_rows(symbol: str, strategy: str) -> list[dict]:
    normalized_symbol = str(symbol or '').upper()
    normalized_strategy = str(strategy or '').lower()
    if not POSITIONS_PATH.exists():
        return []
    payload = json.loads(POSITIONS_PATH.read_text(encoding='utf-8'))
    rows = payload.get('positions') if isinstance(payload, dict) else payload
    results = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if str(row.get('symbol') or '').upper() != normalized_symbol:
            continue
        if str(row.get('strategy') or '').lower() != normalized_strategy:
            continue
        if str(row.get('status') or 'open') != 'open':
            continue
        entry_context = row.get('entry_context') or {}
        results.append(
            {
                'symbol': row.get('symbol'),
                'strategy': row.get('strategy'),
                'side': row.get('side'),
                'size': row.get('size'),
                'initial_size': row.get('initial_size', entry_context.get('initial_size')),
                'partial_taken': row.get('partial_taken', entry_context.get('partial_taken')),
                'unrealized_pnl': row.get('unrealized_pnl'),
                'max_profit': row.get('max_profit'),
                'timestamp': row.get('timestamp'),
            }
        )
    return results


def monitor_for_symbol(symbol: str) -> dict:
    payload = req('/monitor', method='POST', payload={})
    rows = []
    for row in payload.get('updated') or []:
        if str(row.get('symbol') or '').upper() != str(symbol or '').upper():
            continue
        rows.append(
            {
                'symbol': row.get('symbol'),
                'action': row.get('action'),
                'strategy': row.get('strategy'),
                'size': row.get('size'),
                'entry_price': row.get('entry_price'),
                'mark_price': row.get('mark_price'),
                'unrealized_pnl': row.get('unrealized_pnl'),
                'tp_action': ((row.get('tp_detail') or {}).get('action')),
                'profile_actions': ((row.get('tp_detail') or {}).get('profile_actions') or []),
                'tp_reason': ((row.get('tp_detail') or {}).get('reason')),
            }
        )
    return {
        'skipped': payload.get('skipped'),
        'guard': payload.get('guard'),
        'errors': payload.get('errors') or [],
        'rows': rows,
    }


def save_report(report: dict) -> None:
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


def wait_for_monitor_window() -> dict:
    while True:
        payload = req('/monitor', method='POST', payload={})
        if not payload.get('skipped'):
            return payload
        guard = payload.get('guard') or {}
        running_until = int(guard.get('running_until') or 0)
        delay = max(5, running_until - int(time.time()) + 2)
        time.sleep(delay)


def main() -> None:
    report: dict = {
        'symbol': SYMBOL,
        'alert_name': ALERT_NAME,
        'side_action': SIDE_ACTION,
        'poll_seconds': POLL_SECONDS,
        'max_polls': MAX_POLLS,
        'history': [],
    }

    pre_cleanup = req('/webhook', method='POST', payload={'symbol': SYMBOL, 'action': 'CLOSE', 'note': 'copilot_partial_vs_trailing_pre_cleanup'})
    report['pre_cleanup'] = {'status': pre_cleanup.get('status'), 'reason': pre_cleanup.get('reason')}
    time.sleep(3)

    open_response = req(
        '/webhook',
        method='POST',
        payload={
            'symbol': SYMBOL,
            'action': SIDE_ACTION,
            'alert_name': ALERT_NAME,
            'note': 'copilot_partial_vs_trailing_open',
        },
    )
    report['open_response'] = open_response
    save_report(report)

    if str(open_response.get('status')) != 'ok':
        report['result'] = 'open_failed'
        save_report(report)
        print(json.dumps({'result': 'open_failed', 'open_response': open_response}, ensure_ascii=False, indent=2))
        return

    stop_reason = 'timeout'
    saw_open = False

    for index in range(MAX_POLLS):
        registry_rows = load_registry_rows(SYMBOL, ALERT_NAME)
        monitor_snapshot = monitor_for_symbol(SYMBOL)
        if monitor_snapshot.get('skipped'):
            monitor_snapshot = wait_for_monitor_window()
        snapshot = {
            'idx': index + 1,
            'ts': int(time.time()),
            'registry_rows': registry_rows,
            'monitor': monitor_snapshot,
        }
        symbol_actions = [row.get('action') for row in monitor_snapshot.get('rows', []) if row.get('action')]

        if registry_rows:
            saw_open = True

        symbol_actions = [row.get('action') for row in monitor_snapshot.get('rows', []) if row.get('action')]
        if any(action in STOP_ACTIONS for action in symbol_actions):
            stop_reason = f"monitor_action:{','.join(symbol_actions)}"
            break

        if saw_open and not registry_rows:
            stop_reason = 'registry_empty_after_open'
            break

        save_report(report)
        time.sleep(POLL_SECONDS)

    report['stop_reason'] = stop_reason
    final_registry = load_registry_rows(SYMBOL, ALERT_NAME)
    report['final_registry_rows'] = final_registry

    if final_registry:
        cleanup_response = req('/webhook', method='POST', payload={'symbol': SYMBOL, 'action': 'CLOSE', 'note': 'copilot_partial_vs_trailing_cleanup'})
    else:
        cleanup_response = {'status': 'noop', 'reason': 'registry_already_empty'}
    report['cleanup_response'] = cleanup_response
    report['result'] = 'completed'

    save_report(report)
    summary = {
        'result': report['result'],
        'stop_reason': report['stop_reason'],
        'history_count': len(report['history']),
        'last_snapshot': report['history'][-1] if report['history'] else None,
        'cleanup_status': cleanup_response.get('status'),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()