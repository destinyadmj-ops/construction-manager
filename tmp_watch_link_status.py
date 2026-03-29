import json
import argparse
import os
import time
import urllib.request


BASE_URL = 'http://127.0.0.1:5001'
CHECKS = 12
INTERVAL_SECONDS = 5


def _parse_csv(value: str | None) -> set[str]:
    tokens = set()
    for token in str(value or '').split(','):
        chunk = str(token or '').strip().upper()
        if chunk:
            tokens.add(chunk)
    return tokens


def _request_json(path: str, method: str = 'GET', payload=None, timeout: int = 40):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(BASE_URL + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--symbols', default=os.getenv('WATCH_SYMBOLS', ''))
    parser.add_argument('--actions', default=os.getenv('WATCH_ACTIONS', ''))
    parser.add_argument('--only-unlinked', action='store_true', default=str(os.getenv('WATCH_ONLY_UNLINKED', '')).strip().lower() in {'1', 'true', 'yes', 'on'})
    parser.add_argument('--only-reconcile', action='store_true', default=str(os.getenv('WATCH_ONLY_RECONCILE', '')).strip().lower() in {'1', 'true', 'yes', 'on'})
    parser.add_argument('--checks', type=int, default=int(os.getenv('WATCH_CHECKS', str(CHECKS))))
    parser.add_argument('--interval', type=int, default=int(os.getenv('WATCH_INTERVAL_SECONDS', str(INTERVAL_SECONDS))))
    parser.add_argument('--output-path', default=os.getenv('WATCH_OUTPUT_PATH', '').strip())
    args = parser.parse_args()

    symbol_filter = _parse_csv(args.symbols)
    action_filter = _parse_csv(args.actions)
    history = []
    for index in range(1, max(1, args.checks) + 1):
        payload = _request_json('/monitor', method='POST', payload={})
        rows = []
        for row in (payload.get('updated') or []):
            symbol = str(row.get('symbol') or '').upper()
            action = str(row.get('action') or '').upper()
            link_status = str(row.get('link_status') or '').strip()
            reconcile = row.get('reconcile')
            if symbol_filter and symbol not in symbol_filter:
                continue
            if action_filter and action not in action_filter:
                continue
            if args.only_unlinked and link_status != 'no_open_learning_trade_match':
                continue
            if args.only_reconcile and not reconcile:
                continue
            rows.append({
                'symbol': row.get('symbol'),
                'action': row.get('action'),
                'bot_name': row.get('bot_name'),
                'link_status': link_status,
                'monitor_profile_source': row.get('monitor_profile_source'),
                'reconcile': reconcile,
            })
        snapshot = {
            'idx': index,
            'ts': int(time.time()),
            'skipped': payload.get('skipped'),
            'guard': payload.get('guard'),
            'updated_count': len(rows),
            'rows': rows,
            'errors': payload.get('errors') or [],
        }
        history.append(snapshot)
        print(json.dumps(snapshot, ensure_ascii=False), flush=True)
        if index < max(1, args.checks):
            time.sleep(max(1, args.interval))

    if args.output_path:
        try:
            import pathlib
            out_path = pathlib.Path(args.output_path)
            out_path.write_text(json.dumps({'finished': True, 'history': history}, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception as ex:
            print(json.dumps({'output_path_error': str(ex)}, ensure_ascii=False), flush=True)
    else:
        print(json.dumps({'finished': True, 'history_count': len(history)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()