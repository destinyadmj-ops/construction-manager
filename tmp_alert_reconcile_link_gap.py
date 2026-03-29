import json
import argparse
import os
import sys
import urllib.request


BASE_URL = 'http://127.0.0.1:5001'
NO_LINK_THRESHOLD = 1


def _request_json(path: str, timeout: int = 20):
    request = urllib.request.Request(BASE_URL + path)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--threshold', type=int, default=int(os.getenv('RECONCILE_NO_LINK_THRESHOLD', str(NO_LINK_THRESHOLD))))
    parser.add_argument('--window-seconds', type=int, default=int(os.getenv('RECONCILE_ALERT_WINDOW_SECONDS', '86400')))
    parser.add_argument('--recent-limit', type=int, default=int(os.getenv('RECONCILE_ALERT_RECENT_LIMIT', '10')))
    args = parser.parse_args()

    payload = _request_json(f'/reconcile-stats?window_seconds={max(0, args.window_seconds)}&recent_limit={max(1, args.recent_limit)}')
    no_link_count = int(payload.get('no_linked_open_learning_trade') or 0)
    events = int(payload.get('events') or 0)

    result = {
        'status': 'ok' if no_link_count < args.threshold else 'alert',
        'events': events,
        'no_linked_open_learning_trade': no_link_count,
        'threshold': args.threshold,
        'recent_events': payload.get('recent_events') or [],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if no_link_count >= args.threshold:
        sys.exit(1)


if __name__ == '__main__':
    main()