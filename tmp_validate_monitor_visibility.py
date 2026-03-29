import json
import time
import urllib.request


BASE_URL = 'http://127.0.0.1:5001'
CANDIDATES = ['POLYXUSDT', 'SOLUSDT', 'BTCUSDT', 'DOGEUSDT']


def req(path, method='GET', payload=None, timeout=30):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(BASE_URL + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def find_free_symbol():
    for symbol in CANDIDATES:
        monitor = req('/monitor', method='POST', payload={})
        if monitor.get('skipped') == 'already_running':
            time.sleep(6)
            continue
        registry = [
            row for row in (monitor.get('registry_positions') or [])
            if str(row.get('symbol') or '').upper() == symbol
        ]
        if not registry:
            return symbol
    return CANDIDATES[0]


def poll_symbol(symbol, tries=12, sleep_seconds=6):
    normalized_symbol = str(symbol or '').upper()
    for _ in range(tries):
        payload = req('/monitor', method='POST', payload={})
        if payload.get('skipped') == 'already_running':
            time.sleep(sleep_seconds)
            continue
        updated = [
            row for row in (payload.get('updated') or [])
            if str(row.get('symbol') or '').upper() == normalized_symbol
        ]
        registry = [
            row for row in (payload.get('registry_positions') or [])
            if str(row.get('symbol') or '').upper() == normalized_symbol
        ]
        return payload, updated, registry
    return {}, [], []


def main():
    symbol = find_free_symbol()
    summary = {'symbol': symbol}

    req('/webhook', method='POST', payload={'symbol': symbol, 'action': 'CLOSE', 'note': 'copilot_monitor_visibility_cleanup_pre'})
    open_a = req('/webhook', method='POST', payload={'symbol': symbol, 'action': 'BUY', 'alert_name': 'alert_a', 'note': 'copilot_monitor_visibility_a'})
    open_b = req('/webhook', method='POST', payload={'symbol': symbol, 'action': 'BUY', 'alert_name': 'alert_b', 'note': 'copilot_monitor_visibility_b'})

    payload, updated, registry = poll_symbol(symbol)
    summary['open_a'] = {'status': open_a.get('status'), 'opened_trade_id': open_a.get('opened_trade_id')}
    summary['open_b'] = {'status': open_b.get('status'), 'opened_trade_id': open_b.get('opened_trade_id')}
    summary['monitor'] = {
        'status': payload.get('status'),
        'exchange_position_count': payload.get('exchange_position_count'),
        'registry_count': len(registry),
        'registry_strategies': [row.get('strategy') for row in registry],
        'updated_count': len(updated),
        'updated_strategies': [row.get('bot_name') for row in updated],
        'updated_trade_ids': [((row.get('registry_position') or {}).get('trade_id')) for row in updated],
        'has_decision_all': all('decision' in row for row in updated),
        'has_registry_position_all': all('registry_position' in row for row in updated),
        'profile_sources': sorted(set(str(row.get('monitor_profile_source')) for row in updated)),
    }

    close_a = req('/webhook', method='POST', payload={'symbol': symbol, 'action': 'CLOSE', 'alert_name': 'alert_a', 'note': 'copilot_monitor_visibility_close_a'})
    _, updated_after_a, registry_after_a = poll_symbol(symbol)
    close_b = req('/webhook', method='POST', payload={'symbol': symbol, 'action': 'CLOSE', 'alert_name': 'alert_b', 'note': 'copilot_monitor_visibility_close_b'})

    summary['after_close_a'] = {
        'close_a_status': close_a.get('status'),
        'registry_count': len(registry_after_a),
        'registry_strategies': [row.get('strategy') for row in registry_after_a],
        'updated_strategies': [row.get('bot_name') for row in updated_after_a],
    }
    summary['close_b'] = {'status': close_b.get('status')}

    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()