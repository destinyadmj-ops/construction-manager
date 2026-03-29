import json
import argparse
import os
import time
import urllib.request
from pathlib import Path


BASE_URL = 'http://127.0.0.1:5001'
CHECKS = 30
INTERVAL_SECONDS = 60
OUTPUT_PATH = Path('reconcile_stats_observation.json')


def _request_json(path: str, timeout: int = 40):
    request = urllib.request.Request(BASE_URL + path)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checks', type=int, default=int(os.getenv('RECONCILE_OBS_CHECKS', str(CHECKS))))
    parser.add_argument('--interval', type=int, default=int(os.getenv('RECONCILE_OBS_INTERVAL_SECONDS', str(INTERVAL_SECONDS))))
    parser.add_argument('--window-seconds', type=int, default=int(os.getenv('RECONCILE_OBS_WINDOW_SECONDS', '86400')))
    parser.add_argument('--recent-limit', type=int, default=int(os.getenv('RECONCILE_OBS_RECENT_LIMIT', '10')))
    parser.add_argument('--output-path', default=os.getenv('RECONCILE_OBS_OUTPUT_PATH', str(OUTPUT_PATH)))
    args = parser.parse_args()

    output_path = Path(args.output_path)
    history = []
    for index in range(1, max(1, args.checks) + 1):
        payload = _request_json(f'/reconcile-stats?window_seconds={max(0, args.window_seconds)}&recent_limit={max(1, args.recent_limit)}')
        snapshot = {
            'idx': index,
            'ts': int(time.time()),
            'events': payload.get('events', 0),
            'registry_closed': payload.get('registry_closed', 0),
            'learning_closed': payload.get('learning_closed', 0),
            'no_linked_open_learning_trade': payload.get('no_linked_open_learning_trade', 0),
            'recent_events': payload.get('recent_events') or [],
        }
        history.append(snapshot)
        output_path.write_text(json.dumps({'finished': False, 'last_index': index, 'history': history}, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(snapshot, ensure_ascii=False), flush=True)
        if index < max(1, args.checks):
            time.sleep(max(1, args.interval))

    output_path.write_text(json.dumps({'finished': True, 'last_index': max(1, args.checks), 'history': history}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'finished': True, 'history_count': len(history), 'output_path': str(output_path)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()