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


def _resolve_db_path():
    configured = str(os.getenv('RUNTIME_DB', '') or '').strip()
    if configured:
        if os.name == 'nt' and configured.startswith('/'):
            configured = ''
        else:
            parent = os.path.dirname(configured)
            if parent:
                try:
                    os.makedirs(parent, exist_ok=True)
                except Exception:
                    configured = ''
    if configured:
        return configured
    local_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'database')
    os.makedirs(local_dir, exist_ok=True)
    return os.path.join(local_dir, 'runtime_state.db')


_DB_PATH = _resolve_db_path()


def _env_float(name: str, default: float, min_value: float | None = None, max_value: float | None = None) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except Exception:
        value = float(default)
    if min_value is not None:
        value = max(float(min_value), value)
    if max_value is not None:
        value = min(float(max_value), value)
    return float(value)


def _parse_trail_tiers(env_key: str, default_tiers: list[tuple[float, float]]) -> list[tuple[float, float]]:
    raw = str(os.getenv(env_key, '') or '').strip()
    if not raw:
        return list(default_tiers)

    tiers: list[tuple[float, float]] = []
    for part in raw.split(','):
        token = str(part or '').strip()
        if not token:
            continue
        if ':' not in token:
            continue
        left, right = token.split(':', 1)
        try:
            threshold = float(left.strip())
            ratio = float(right.strip())
        except Exception:
            continue
        if threshold < 0:
            continue
        ratio = max(0.0001, min(0.95, ratio))
        tiers.append((threshold, ratio))

    if not tiers:
        return list(default_tiers)
    tiers.sort(key=lambda item: item[0])
    return tiers


def _trailing_cfg_for(alert_key: str, defaults: dict) -> dict:
    key = str(alert_key or '').upper()
    return {
        'safety_margin': _env_float(f'{key}_TRAIL_SAFETY_MARGIN', float(defaults.get('safety_margin', 0.005)), min_value=0.0, max_value=0.25),
        'trail_tiers': _parse_trail_tiers(f'{key}_TRAIL_TIERS', list(defaults.get('trail_tiers', []))),
        'max_loss_ratio': _env_float(f'{key}_TRAIL_MAX_LOSS_RATIO', float(defaults.get('max_loss_ratio', 0.02)), min_value=0.0001, max_value=0.95),
    }

# bot名 -> trailing設定
# trail_tiers: [(roi_threshold, trail_ratio), ...]
BOT_TRAILING_CONFIG = {
    'alert_a': _trailing_cfg_for('ALERT_A', {
        'safety_margin':  0.005,
        'trail_tiers':    [(0.010, 0.015), (0.025, 0.025), (0.050, 0.040)],
        'max_loss_ratio': 0.020,
    }),
    'alert_b': _trailing_cfg_for('ALERT_B', {
        'safety_margin':  0.006,
        'trail_tiers':    [(0.008, 0.015), (0.020, 0.025), (0.040, 0.035)],
        'max_loss_ratio': 0.020,
    }),
    'alert_c': _trailing_cfg_for('ALERT_C', {
        'safety_margin':  0.003,
        'trail_tiers':    [(0.005, 0.008), (0.012, 0.012), (0.020, 0.015)],
        'max_loss_ratio': 0.012,
    }),
    'alert_d': _trailing_cfg_for('ALERT_D', {
        'safety_margin':  0.005,
        'trail_tiers':    [(0.008, 0.012), (0.020, 0.020), (0.040, 0.030)],
        'max_loss_ratio': 0.016,
    }),
}

RUNNER_TRAIL_RATIO_MULT = float(os.getenv('RUNNER_TRAIL_RATIO_MULT', '1.35'))
RUNNER_MAX_LOSS_RATIO = float(os.getenv('RUNNER_MAX_LOSS_RATIO', '0.03'))


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
    structure_stop_price: float = None,
    runner_mode: bool = False,
    disable_trailing: bool = False,
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

    null_result = {'stop_price': None, 'triggered': False, 'roi': 0.0, 'trail_ratio': 0.0, 'disabled': bool(disable_trailing)}

    if disable_trailing:
        return null_result

    if current_price <= 0 or size <= 0 or not entry_price:
        return null_result

    key = f'{symbol}:{bot_name}:{side}'
    peak_db, _ = _get_peak(key)

    if side == 'long':
        roi        = (current_price - entry_price) / entry_price
        peak       = max(peak_db or current_price, current_price)
        _set_peak(key, peak, entry_price)

        ratio      = _trail_ratio_for_roi(trail_tiers, roi)
        effective_max_loss_ratio = max_loss_ratio
        if runner_mode:
            ratio = ratio * max(1.0, RUNNER_TRAIL_RATIO_MULT)
            effective_max_loss_ratio = max(effective_max_loss_ratio, RUNNER_MAX_LOSS_RATIO)
        stop_price = peak * (1 - ratio)
        safety_stop = entry_price * (1 - effective_max_loss_ratio - safety_margin)
        stop_price  = max(stop_price, safety_stop)
        if structure_stop_price is not None:
            stop_price = max(stop_price, float(structure_stop_price))

        triggered = bool(current_price <= stop_price)
        if triggered:
            print(f'[{bot_name}] LONG TRAILING SL: price={current_price:.4f} stop={stop_price:.4f} roi={roi:.2%}')
            try:
                close_position(symbol, 'sell', size)
            except Exception as e:
                print(f'[{bot_name}] close_position failed: {e}')
            _del_peak(key)

        return {'stop_price': round(stop_price, 6), 'triggered': triggered, 'roi': roi, 'trail_ratio': ratio, 'disabled': False}

    elif side == 'short':
        roi        = (entry_price - current_price) / entry_price
        peak       = min(peak_db or current_price, current_price)
        _set_peak(key, peak, entry_price)

        ratio      = _trail_ratio_for_roi(trail_tiers, roi)
        effective_max_loss_ratio = max_loss_ratio
        if runner_mode:
            ratio = ratio * max(1.0, RUNNER_TRAIL_RATIO_MULT)
            effective_max_loss_ratio = max(effective_max_loss_ratio, RUNNER_MAX_LOSS_RATIO)
        stop_price = peak * (1 + ratio)
        safety_stop = entry_price * (1 + effective_max_loss_ratio + safety_margin)
        stop_price  = min(stop_price, safety_stop)
        if structure_stop_price is not None:
            stop_price = min(stop_price, float(structure_stop_price))

        triggered = bool(current_price >= stop_price)
        if triggered:
            print(f'[{bot_name}] SHORT TRAILING SL: price={current_price:.4f} stop={stop_price:.4f} roi={roi:.2%}')
            try:
                close_position(symbol, 'buy', size)
            except Exception as e:
                print(f'[{bot_name}] close_position failed: {e}')
            _del_peak(key)

        return {'stop_price': round(stop_price, 6), 'triggered': triggered, 'roi': roi, 'trail_ratio': ratio, 'disabled': False}

    return null_result


def clear_bot_peak(symbol: str, bot_name: str, side: str = '') -> None:
    """ポジションクローズ後にピーク追跡レコードを削除"""
    _del_peak(f'{symbol}:{bot_name}:{side}')
