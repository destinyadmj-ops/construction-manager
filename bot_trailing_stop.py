"""
bot_trailing_stop.py

各ボット(A/B/C/D)の戦略特性に合わせた個別トレーリングストップエンジン。
ピーク価格はSQLiteに永続化し、Gunicorn マルチworker 間で共有する。

Bot特性:
  Alert A (OB+Sweep Sniper):     タイト  trail 1.0-2.0%  max_loss 1.5%
  Alert B (Market Regime Trend): ワイド  trail 2.0-4.0%  max_loss 2.0%
  Alert C (Range Rebound):       超タイト trail 0.8-1.8% max_loss 1.2%
  Alert D (Trigger Sniper):      ミディアム trail 1.2-2.8% max_loss 1.6%
"""
import os
import sqlite3
import time

from bot_v2.execution.order_manager import close_position

_DB_PATH = os.getenv('RUNTIME_DB', '/home/linuxuser/bot_v2/database/runtime_state.db')

# bot名 -> trailing設定
# trail_tiers: [(roi_threshold, trail_ratio), ...]
BOT_TRAILING_CONFIG = {
    'alert_a': {
        'safety_margin':  0.004,
        'trail_tiers':    [(0.005, 0.010), (0.015, 0.015), (999.0, 0.020)],
        'max_loss_ratio': 0.015,
    },
    'alert_b': {
        'safety_margin':  0.006,
        'trail_tiers':    [(0.010, 0.020), (0.025, 0.030), (999.0, 0.040)],
        'max_loss_ratio': 0.020,
    },
    'alert_c': {
        'safety_margin':  0.003,
        'trail_tiers':    [(0.004, 0.008), (0.010, 0.012), (999.0, 0.018)],
        'max_loss_ratio': 0.012,
    },
    'alert_d': {
        'safety_margin':  0.005,
        'trail_tiers':    [(0.005, 0.012), (0.020, 0.020), (999.0, 0.028)],
        'max_loss_ratio': 0.016,
    },
}


def _conn():
    c = sqlite3.connect(_DB_PATH)
    c.execute('PRAGMA journal_mode=WAL')
    return c


def _ensure_table():
    conn = _conn()
    conn.execute(
        'CREATE TABLE IF NOT EXISTS bot_trailing_peaks ('
        '    key         TEXT PRIMARY KEY,'
        '    peak_price  REAL NOT NULL,'
        '    entry_price REAL NOT NULL,'
        '    updated_at  INTEGER NOT NULL'
        ')'
    )
    conn.commit()
    conn.close()


_ensure_table()


def _get_peak(key: str):
    conn = _conn()
    cur = conn.cursor()
    cur.execute(
        'SELECT peak_price, entry_price FROM bot_trailing_peaks WHERE key = ?',
        (key,)
    )
    row = cur.fetchone()
    conn.close()
    return (row[0], row[1]) if row else (None, None)


def _set_peak(key: str, peak_price: float, entry_price: float):
    conn = _conn()
    conn.execute(
        'INSERT OR REPLACE INTO bot_trailing_peaks (key, peak_price, entry_price, updated_at) VALUES (?, ?, ?, ?)',
        (key, peak_price, entry_price, int(time.time())),
    )
    conn.commit()
    conn.close()


def _del_peak(key: str):
    conn = _conn()
    conn.execute('DELETE FROM bot_trailing_peaks WHERE key = ?', (key,))
    conn.commit()
    conn.close()


def _trail_ratio_for_roi(trail_tiers: list, roi: float) -> float:
    for threshold, ratio in trail_tiers:
        if roi < threshold:
            return ratio
    return trail_tiers[-1][1]


def update_bot_trailing(
    symbol: str,
    position: dict,
    entry_price: float,
    bot_name: str = 'alert_d',
) -> dict:
    """
    bot別トレーリングストップを更新し、ヒット時はポジションをクローズ。

    Returns:
        {
          'stop_price':  float | None,
          'triggered':   bool,
          'roi':         float,
          'trail_ratio': float,
        }
    """
    cfg = BOT_TRAILING_CONFIG.get(bot_name, BOT_TRAILING_CONFIG['alert_d'])
    trail_tiers    = cfg['trail_tiers']
    safety_margin  = cfg['safety_margin']
    max_loss_ratio = cfg['max_loss_ratio']

    side          = str(position.get('holdSide', '')).lower()
    current_price = float(position.get('markPrice', 0) or 0)
    size          = float(position.get('total', 0) or 0)

    null_result = {'stop_price': None, 'triggered': False, 'roi': 0.0, 'trail_ratio': 0.0}

    if current_price <= 0 or size <= 0 or not entry_price:
        return null_result

    key = f'{symbol}:{bot_name}:{side}'
    peak_db, _ = _get_peak(key)

    if side == 'long':
        roi        = (current_price - entry_price) / entry_price
        peak       = max(peak_db or current_price, current_price)
        _set_peak(key, peak, entry_price)

        ratio      = _trail_ratio_for_roi(trail_tiers, roi)
        stop_price = peak * (1 - ratio)
        safety_stop = entry_price * (1 - max_loss_ratio - safety_margin)
        stop_price  = max(stop_price, safety_stop)

        triggered = bool(current_price <= stop_price)
        if triggered:
            print(f'[{bot_name}] LONG TRAILING SL: price={current_price:.4f} stop={stop_price:.4f} roi={roi:.2%}')
            try:
                close_position(symbol, 'sell', size)
            except Exception as e:
                print(f'[{bot_name}] close_position failed: {e}')
            _del_peak(key)

        return {'stop_price': round(stop_price, 6), 'triggered': triggered, 'roi': roi, 'trail_ratio': ratio}

    elif side == 'short':
        roi        = (entry_price - current_price) / entry_price
        peak       = min(peak_db or current_price, current_price)
        _set_peak(key, peak, entry_price)

        ratio      = _trail_ratio_for_roi(trail_tiers, roi)
        stop_price = peak * (1 + ratio)
        safety_stop = entry_price * (1 + max_loss_ratio + safety_margin)
        stop_price  = min(stop_price, safety_stop)

        triggered = bool(current_price >= stop_price)
        if triggered:
            print(f'[{bot_name}] SHORT TRAILING SL: price={current_price:.4f} stop={stop_price:.4f} roi={roi:.2%}')
            try:
                close_position(symbol, 'buy', size)
            except Exception as e:
                print(f'[{bot_name}] close_position failed: {e}')
            _del_peak(key)

        return {'stop_price': round(stop_price, 6), 'triggered': triggered, 'roi': roi, 'trail_ratio': ratio}

    return null_result


def clear_bot_peak(symbol: str, bot_name: str, side: str = '') -> None:
    """ポジションクローズ後にピーク追跡レコードを削除"""
    _del_peak(f'{symbol}:{bot_name}:{side}')
