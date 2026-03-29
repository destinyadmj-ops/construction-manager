import json
import time
import urllib.request
from pathlib import Path


BASE_URL = 'http://127.0.0.1:5001'
SYMBOL = 'DOGEUSDT'
POSITIONS_PATH = Path('/home/linuxuser/bot_v2/data/positions.json')
LEARNING_PATH = Path('/home/linuxuser/bot_v2/data/alert_learning_state.json')


def req(path, method='GET', payload=None, timeout=30):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(BASE_URL + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def poll_registry(symbol, tries=10, sleep_seconds=6):
    normalized_symbol = str(symbol or '').upper()
    for _ in range(tries):
        payload = req('/monitor', method='POST', payload={})
        if payload.get('skipped') == 'already_running':
            time.sleep(sleep_seconds)
            continue
        return [
            row for row in (payload.get('registry_positions') or [])
            if str(row.get('symbol') or '').upper() == normalized_symbol
        ]
    return []


def read_open_state(symbol, strategy):
    normalized_symbol = str(symbol or '').upper()
    normalized_strategy = str(strategy or '').lower()
    positions = []
    trades = []

    if POSITIONS_PATH.exists():
        loaded = json.loads(POSITIONS_PATH.read_text(encoding='utf-8'))
        positions = [
            row for row in (loaded.get('positions') or [])
            if str(row.get('symbol') or '').upper() == normalized_symbol
            and str(row.get('strategy') or '').lower() == normalized_strategy
            and str(row.get('status') or 'open') == 'open'
        ]

    if LEARNING_PATH.exists():
        loaded = json.loads(LEARNING_PATH.read_text(encoding='utf-8'))
        trades = [
            row for row in (loaded.get('trades') or [])
            if str(row.get('symbol') or '').upper() == normalized_symbol
            and str(row.get('alert') or '').lower() == normalized_strategy
            and str(row.get('result') or '') == 'open'
        ]

    return {
        'registry_sizes': [row.get('size') for row in positions],
        'registry_trade_ids': [row.get('trade_id') for row in positions],
        'learning_sizes': [row.get('size') for row in trades],
        'learning_trade_ids': [row.get('trade_id') for row in trades],
    }


def main():
    summary = {}
    req('/webhook', method='POST', payload={'symbol': SYMBOL, 'action': 'CLOSE', 'note': 'copilot_partial_fix_cleanup_file'})

    open_response = req('/webhook', method='POST', payload={
        'symbol': SYMBOL,
        'action': 'BUY',
        'alert_name': 'alert_a',
        'note': 'copilot_partial_fix_open_file',
    })
    summary['open_status'] = open_response.get('status')
    summary['opened_trade_id'] = open_response.get('opened_trade_id')

    open_registry = poll_registry(SYMBOL)
    summary['open_registry_sizes'] = [row.get('size') for row in open_registry]
    summary['open_state_files'] = read_open_state(SYMBOL, 'alert_a')
    original_size = float((open_registry[0] if open_registry else {}).get('size') or 0.0)
    half_size = round(original_size / 2.0, 8)
    summary['half_size'] = half_size

    half_close_response = req('/webhook', method='POST', payload={
        'symbol': SYMBOL,
        'action': 'CLOSE',
        'alert_name': 'alert_a',
        'size': half_size,
        'note': 'copilot_partial_fix_half_file',
    })
    summary['half_close'] = {
        'status': half_close_response.get('status'),
        'closed_trade_ids': half_close_response.get('closed_trade_ids'),
        'partial_close_meta': half_close_response.get('partial_close_meta'),
    }

    half_registry = poll_registry(SYMBOL)
    summary['half_registry_sizes'] = [row.get('size') for row in half_registry]
    summary['half_state_files'] = read_open_state(SYMBOL, 'alert_a')

    final_close_response = req('/webhook', method='POST', payload={'symbol': SYMBOL, 'action': 'CLOSE', 'note': 'copilot_partial_fix_final_cleanup_file'})
    summary['final_close_status'] = final_close_response.get('status')
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()