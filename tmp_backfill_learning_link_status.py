import json
from pathlib import Path


POSITIONS_PATH = Path('bot_v2/data/positions.json')
LEARNING_PATH = Path('bot_v2/data/alert_learning_state.json')


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default


def _normalize_alert(value):
    alert = str(value or 'alert_d').strip().lower()
    return alert if alert in ('alert_a', 'alert_b', 'alert_c', 'alert_d') else 'alert_d'


def _normalize_side(value):
    side = str(value or '').strip().lower()
    if side in ('buy', 'long', 'open_long'):
        return 'buy'
    if side in ('sell', 'short', 'open_short'):
        return 'sell'
    return ''


def _load_json(path: Path):
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding='utf-8'))


def _find_match(trades, symbol, strategy, side, size):
    candidates = []
    for trade in trades:
        if str(trade.get('result') or '') != 'open':
            continue
        if str(trade.get('symbol') or '').upper() != str(symbol or '').upper():
            continue
        if _normalize_alert(trade.get('alert') or trade.get('alert_name')) != _normalize_alert(strategy):
            continue
        if _normalize_side(trade.get('side')) != _normalize_side(side):
            continue
        candidates.append(trade)
    if not candidates:
        return None
    target_size = max(0.0, _safe_float(size, 0.0))
    return min(
        candidates,
        key=lambda item: (
            abs(_safe_float(item.get('size'), 0.0) - target_size),
            -int(item.get('trade_id', 0) or 0),
        ),
    )


def main():
    positions_state = _load_json(POSITIONS_PATH)
    learning_state = _load_json(LEARNING_PATH)
    positions = positions_state.get('positions') or []
    trades = learning_state.get('trades') or []

    updated = []
    unchanged = 0
    for row in positions:
        if not isinstance(row, dict):
            continue
        if str(row.get('status') or 'open') != 'open':
            continue

        entry_context = dict(row.get('entry_context') or {})
        current_learning_trade_id = int(entry_context.get('learning_trade_id') or 0)
        matched_trade = None
        if current_learning_trade_id <= 0:
            matched_trade = _find_match(
                trades,
                symbol=row.get('symbol'),
                strategy=row.get('strategy'),
                side=row.get('side'),
                size=row.get('size'),
            )
            if matched_trade:
                entry_context['learning_trade_id'] = int(matched_trade.get('trade_id', 0) or 0)

        if int(entry_context.get('learning_trade_id') or 0) > 0:
            entry_context['link_status'] = 'linked_learning_trade'
        else:
            entry_context['link_status'] = 'no_open_learning_trade_match'

        if entry_context != (row.get('entry_context') or {}):
            row['entry_context'] = entry_context
            updated.append({
                'symbol': row.get('symbol'),
                'strategy': row.get('strategy'),
                'side': row.get('side'),
                'learning_trade_id': entry_context.get('learning_trade_id'),
                'link_status': entry_context.get('link_status'),
            })
        else:
            unchanged += 1

    positions_state['positions'] = positions
    POSITIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    POSITIONS_PATH.write_text(json.dumps(positions_state, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'updated': updated, 'updated_count': len(updated), 'unchanged_open_rows': unchanged}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()