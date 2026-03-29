from __future__ import annotations
import json
import time
from datetime import datetime
from urllib import request
from pathlib import Path

BASE_URL = 'http://127.0.0.1:5001'
SYMBOLS = [
    'BTCUSDT', 'SOLUSDT', 'ETHUSDT', 'XRPUSDT', 'DOGEUSDT',
    'SIRENUSDT', 'RIVERUSDT', 'PEPEUSDT', 'SIBUSDT', 'PIPPINUSDT'
]
POLL_SECONDS = 30
MAX_POLLS = int(2 * 60 * 60 / POLL_SECONDS)  # 2時間分
REPORT_PATH = Path(f'/home/linuxuser/monitor_multi_symbol_report_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json')


def req(path: str, method: str = 'GET', payload: dict | None = None, timeout: int = 40) -> dict:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    http_request = request.Request(BASE_URL + path, data=data, method=method, headers=headers)
    with request.urlopen(http_request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def main():
    action_stats = {symbol: {} for symbol in SYMBOLS}
    history = []
    for poll_idx in range(MAX_POLLS):
        poll_time = int(time.time())
        poll_result = {'ts': poll_time, 'symbols': {}}
        try:
            payload = req('/monitor', method='POST', payload={})
            for row in payload.get('updated', []):
                symbol = str(row.get('symbol', '')).upper()
                if symbol not in SYMBOLS:
                    continue
                action = row.get('action') or 'none'
                poll_result['symbols'][symbol] = action
                action_stats[symbol][action] = action_stats[symbol].get(action, 0) + 1
        except Exception as exc:
            poll_result['error'] = str(exc)
        history.append(poll_result)
        print(f"[{datetime.now().strftime('%H:%M:%S')}] poll {poll_idx+1}/{MAX_POLLS}")
        time.sleep(POLL_SECONDS)
    # save report
    report = {
        'symbols': SYMBOLS,
        'poll_seconds': POLL_SECONDS,
        'max_polls': MAX_POLLS,
        'action_stats': action_stats,
        'history': history,
        'finished_at': datetime.now().isoformat(),
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"\n=== Action Summary ===\n" + json.dumps(action_stats, ensure_ascii=False, indent=2))
    print(f"Report saved: {REPORT_PATH}")


if __name__ == '__main__':
    main()
