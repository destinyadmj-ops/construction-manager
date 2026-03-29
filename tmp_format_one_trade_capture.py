from __future__ import annotations

import json
from pathlib import Path

INPUT_PATH = Path('/home/linuxuser/one_trade_capture_report.json')
OUTPUT_PATH = Path('/home/linuxuser/one_trade_capture_summary.json')


def main() -> None:
    if not INPUT_PATH.exists():
        OUTPUT_PATH.write_text(json.dumps({'status': 'missing_report'}, ensure_ascii=False, indent=2), encoding='utf-8')
        print(OUTPUT_PATH.read_text(encoding='utf-8'))
        return

    payload = json.loads(INPUT_PATH.read_text(encoding='utf-8', errors='ignore'))
    capture = payload.get('capture') or {}
    size_meta = capture.get('size_meta') or {}
    monitor = capture.get('monitor') or {}
    metrics = capture.get('metrics') or {}
    monitor_trace = capture.get('monitor_trace') or []

    summary = {
        'status': payload.get('status'),
        'symbol': capture.get('symbol'),
        'open_order_id': capture.get('open_order_id'),
        'close_order_id': capture.get('close_order_id'),
        'size_meta': {
            'entry_margin_balance_pct': size_meta.get('entry_margin_balance_pct'),
            'live_balance': size_meta.get('live_balance'),
            'target_margin_notional': size_meta.get('target_margin_notional'),
            'target_leverage_for_size': size_meta.get('target_leverage_for_size'),
            'estimated_mark_price': size_meta.get('estimated_mark_price'),
            'base_size': size_meta.get('base_size'),
        },
        'monitor': {
            'action': monitor.get('action'),
            'strategy': monitor.get('strategy') or ((monitor.get('registry_position') or {}).get('strategy')),
            'size': monitor.get('size'),
            'entry_price': monitor.get('entry_price'),
            'mark_price': monitor.get('mark_price'),
            'tp_action': (monitor.get('tp_detail') or {}).get('action'),
            'tp_reason': (monitor.get('tp_detail') or {}).get('reason'),
            'profile_actions': (monitor.get('tp_detail') or {}).get('profile_actions') or [],
            'monitor_profile_source': monitor.get('monitor_profile_source'),
        },
        'metrics': metrics,
        'comparison_table': [
            {'item': 'base_size', 'size_meta': size_meta.get('base_size'), 'monitor': monitor.get('size'), 'delta': metrics.get('rounding_error')},
            {'item': 'estimated_mark_price', 'size_meta': size_meta.get('estimated_mark_price'), 'monitor': monitor.get('mark_price'), 'delta': metrics.get('mark_price_delta')},
            {'item': 'target_margin_notional', 'size_meta': size_meta.get('target_margin_notional'), 'monitor': metrics.get('entry_margin_from_monitor'), 'delta': metrics.get('target_margin_delta')},
        ],
        'monitor_trace': monitor_trace,
        'attempt_count': len(payload.get('attempts') or []),
    }
    OUTPUT_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
