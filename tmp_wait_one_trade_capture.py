from __future__ import annotations

import json
import math
import time
import urllib.request
from pathlib import Path

BASE_URL = 'http://127.0.0.1:5001'
SYMBOLS = ['DOGEUSDT', 'HYPEUSDT', 'XRPUSDT', 'POLYXUSDT', 'SOLUSDT', 'BTCUSDT', 'ETHUSDT']
CHECKS = 90
INTERVAL_SECONDS = 20
MONITOR_POLL_SECONDS = 5
MONITOR_MAX_ATTEMPTS = 12
OUTPUT_PATH = Path('/home/linuxuser/one_trade_capture_report.json')


def req(path: str, method: str = 'GET', payload: dict | None = None, timeout: int = 40):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode('utf-8')
    request = urllib.request.Request(
        BASE_URL + path,
        data=data,
        method=method,
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def percentile(values: list[float], p: float):
    if not values:
        return None
    arr = sorted(values)
    if len(arr) == 1:
        return arr[0]
    k = (len(arr) - 1) * (p / 100.0)
    floor_idx = math.floor(k)
    ceil_idx = math.ceil(k)
    if floor_idx == ceil_idx:
        return arr[int(k)]
    return arr[floor_idx] + (arr[ceil_idx] - arr[floor_idx]) * (k - floor_idx)


def save(status: str, attempts: list[dict], capture: dict | None = None):
    summary = {
        'status': status,
        'attempts': attempts,
        'capture': capture,
    }
    OUTPUT_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')


def main():
    attempts: list[dict] = []
    save('running', attempts)
    for check_idx in range(1, CHECKS + 1):
        for symbol in SYMBOLS:
            record = {
                'check_idx': check_idx,
                'symbol': symbol,
                'open_status': None,
                'reason': None,
                'monitor_trace': [],
                'capture_ready': False,
            }
            try:
                open_resp = req('/webhook', method='POST', payload={'symbol': symbol, 'action': 'BUY', 'alert_name': 'alert_a', 'note': 'copilot_wait_one_trade'})
                record['open_status'] = open_resp.get('status')
                if str(open_resp.get('status')) != 'ok' or not isinstance(open_resp.get('size_meta'), dict):
                    record['reason'] = open_resp.get('reason')
                    attempts.append(record)
                    save('running', attempts)
                    continue

                monitor_detail = None
                for monitor_idx in range(1, MONITOR_MAX_ATTEMPTS + 1):
                    time.sleep(MONITOR_POLL_SECONDS)
                    monitor_resp = req('/monitor', method='POST', payload={})
                    trace_row = {
                        'attempt': monitor_idx,
                        'skipped': monitor_resp.get('skipped'),
                        'guard_reason': (monitor_resp.get('guard') or {}).get('reason'),
                        'updated_count': len(monitor_resp.get('updated') or []),
                    }
                    record['monitor_trace'].append(trace_row)
                    for row in (monitor_resp.get('updated') or []):
                        if str(row.get('symbol') or '').upper() == symbol:
                            monitor_detail = row
                            break
                    if monitor_detail is not None:
                        break

                close_resp = req('/webhook', method='POST', payload={'symbol': symbol, 'action': 'CLOSE', 'note': 'copilot_wait_one_trade_cleanup'})
                record['close_status'] = close_resp.get('status')
                if monitor_detail is None:
                    attempts.append(record)
                    save('running', attempts)
                    continue

                size_meta = open_resp.get('size_meta') or {}
                base_size = float(size_meta.get('base_size') or 0.0)
                live_balance = float(size_meta.get('live_balance') or 0.0)
                target_margin = float(size_meta.get('target_margin_notional') or 0.0)
                leverage = float(size_meta.get('target_leverage_for_size') or 0.0)
                estimated_mark = float(size_meta.get('estimated_mark_price') or 0.0)
                monitor_size = float(monitor_detail.get('size') or 0.0)
                entry_price = float(monitor_detail.get('entry_price') or 0.0)
                mark_price = float(monitor_detail.get('mark_price') or 0.0)
                entry_margin = ((monitor_size * entry_price) / leverage) if monitor_size > 0 and entry_price > 0 and leverage > 0 else None
                effective_margin_ratio = (entry_margin / live_balance) if entry_margin and live_balance > 0 else None
                capture = {
                    'symbol': symbol,
                    'open_order_id': ((open_resp.get('result') or {}).get('data') or {}).get('orderId'),
                    'close_order_id': ((close_resp.get('result') or {}).get('data') or {}).get('orderId') if isinstance(close_resp, dict) else None,
                    'size_meta': size_meta,
                    'monitor': monitor_detail,
                    'monitor_trace': record['monitor_trace'],
                    'metrics': {
                        'rounding_error': monitor_size - base_size,
                        'rounding_error_abs': abs(monitor_size - base_size),
                        'entry_margin_from_monitor': entry_margin,
                        'effective_margin_ratio': effective_margin_ratio,
                        'target_margin_delta': (entry_margin - target_margin) if entry_margin is not None else None,
                        'mark_price_delta': (mark_price - estimated_mark) if estimated_mark and mark_price else None,
                    },
                    'comparison': {
                        'base_size': base_size,
                        'monitor_size': monitor_size,
                        'live_balance': live_balance,
                        'target_margin_notional': target_margin,
                        'estimated_mark_price': estimated_mark,
                        'monitor_entry_price': entry_price,
                        'monitor_mark_price': mark_price,
                    },
                }
                record['capture_ready'] = True
                attempts.append(record)
                save('captured', attempts, capture)
                return
            except Exception as exc:
                record['reason'] = str(exc)[:200]
                attempts.append(record)
                save('running', attempts)
        time.sleep(INTERVAL_SECONDS)
    save('timeout', attempts)


if __name__ == '__main__':
    main()
