import json
import os
import sqlite3
import time
from datetime import datetime, timezone


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


def _parse_float_list(env_key: str, default_values: list[float]) -> list[float]:
    raw = str(os.getenv(env_key, '') or '').strip()
    if not raw:
        return list(default_values)
    values = []
    for part in raw.split(','):
        token = str(part or '').strip()
        if not token:
            continue
        try:
            values.append(float(token))
        except Exception:
            continue
    return values if values else list(default_values)


def _parse_profile(bot_key: str, defaults: dict) -> dict:
    key = str(bot_key or '').upper()
    profile_type = str(os.getenv(f'{key}_TYPE', defaults.get('type', 'balance'))).strip().lower()
    return {
        'type': profile_type,
        'atr_k': float(os.getenv(f'{key}_ATR_K', str(defaults.get('atr_k', 2.0)))),
        'time_exit_min': int(os.getenv(f'{key}_TIME_EXIT_MIN', str(defaults.get('time_exit_min', 10)))),
        'time_exit_min_roi': float(os.getenv(f'{key}_TIME_EXIT_ROI_THRESHOLD', str(defaults.get('time_exit_min_roi', 0.05)))),
        'partial_tp_r': float(os.getenv(f'{key}_PARTIAL_TP_R_MULTIPLE', str(defaults.get('partial_tp_r', 1.5)))),
        'partial_tp_ratio': float(os.getenv(f'{key}_PARTIAL_TP_RATIO', str(defaults.get('partial_tp_ratio', 0.20)))),
        'structure_lookback': int(os.getenv(f'{key}_STRUCTURE_LOOKBACK', str(defaults.get('structure_lookback', 8)))),
        'entry_stop_loss_pct': max(
            0.001,
            min(
                0.95,
                float(os.getenv(f'{key}_ENTRY_STOP_LOSS_PCT', str(defaults.get('entry_stop_loss_pct', 0.08))))
            ),
        ),
        'roi_tp_stage_thresholds': _parse_float_list(f'{key}_ROI_TP_STAGE_THRESHOLDS', defaults.get('roi_tp_stage_thresholds', [0.40, 0.80, 1.50])),
        'roi_tp_stage_partial_ratios': _parse_float_list(f'{key}_ROI_TP_STAGE_PARTIAL_RATIOS', defaults.get('roi_tp_stage_partial_ratios', [0.10, 0.15, 0.20])),
        'roi_stop_lock_levels': _parse_float_list(f'{key}_ROI_STOP_LOCK_LEVELS', defaults.get('roi_stop_lock_levels', [0.10, 0.30, 0.60])),
    }


ROI_TP_STAGE_THRESHOLDS = _parse_float_list('ROI_TP_STAGE_THRESHOLDS', [0.40, 0.80, 1.50])
ROI_TP_STAGE_PARTIAL_RATIOS = _parse_float_list('ROI_TP_STAGE_PARTIAL_RATIOS', [0.10, 0.15, 0.20])
ROI_STOP_LOCK_LEVELS = _parse_float_list('ROI_STOP_LOCK_LEVELS', [0.10, 0.30, 0.60])
ENTRY_STOP_LOSS_PCT = max(0.001, min(0.95, float(os.getenv('ENTRY_STOP_LOSS_PCT', '0.08'))))
TIME_EXIT_MIN_ROI_DEFAULT = float(os.getenv('TIME_EXIT_MIN_ROI_DEFAULT', '0.05'))
POST_PARTIAL_TIME_EXIT_MULTIPLIER = float(os.getenv('POST_PARTIAL_TIME_EXIT_MULTIPLIER', '1.0'))
STRUCTURE_WEAK_BOS_CLOSE_COUNT = max(1, int(os.getenv('STRUCTURE_WEAK_BOS_CLOSE_COUNT', '2')))
MOMENTUM_KILL_ROI_MAX = float(os.getenv('MOMENTUM_KILL_ROI_MAX', '0.20'))
RUNNER_MODE_ROI = float(os.getenv('RUNNER_MODE_ROI', '1.50'))


BOT_PROFILES = {
    'alert_a': _parse_profile('ALERT_A', {
        'type': 'trend',
        'atr_k': 1.6,
        'time_exit_min': 8,
        'time_exit_min_roi': TIME_EXIT_MIN_ROI_DEFAULT,
        'partial_tp_r': 1.2,
        'partial_tp_ratio': 0.20,
        'structure_lookback': 6,
        'entry_stop_loss_pct': ENTRY_STOP_LOSS_PCT,
        'roi_tp_stage_thresholds': ROI_TP_STAGE_THRESHOLDS,
        'roi_tp_stage_partial_ratios': ROI_TP_STAGE_PARTIAL_RATIOS,
        'roi_stop_lock_levels': ROI_STOP_LOCK_LEVELS,
    }),
    'alert_b': _parse_profile('ALERT_B', {
        'type': 'breakout',
        'atr_k': 2.5,
        'time_exit_min': 20,
        'time_exit_min_roi': TIME_EXIT_MIN_ROI_DEFAULT,
        'partial_tp_r': 2.0,
        'partial_tp_ratio': 0.20,
        'structure_lookback': 10,
        'entry_stop_loss_pct': ENTRY_STOP_LOSS_PCT,
        'roi_tp_stage_thresholds': ROI_TP_STAGE_THRESHOLDS,
        'roi_tp_stage_partial_ratios': ROI_TP_STAGE_PARTIAL_RATIOS,
        'roi_stop_lock_levels': ROI_STOP_LOCK_LEVELS,
    }),
    'alert_c': _parse_profile('ALERT_C', {
        'type': 'reversal',
        'atr_k': 1.4,
        'time_exit_min': 6,
        'time_exit_min_roi': TIME_EXIT_MIN_ROI_DEFAULT,
        'partial_tp_r': 1.0,
        'partial_tp_ratio': 0.20,
        'structure_lookback': 5,
        'entry_stop_loss_pct': ENTRY_STOP_LOSS_PCT,
        'roi_tp_stage_thresholds': ROI_TP_STAGE_THRESHOLDS,
        'roi_tp_stage_partial_ratios': ROI_TP_STAGE_PARTIAL_RATIOS,
        'roi_stop_lock_levels': ROI_STOP_LOCK_LEVELS,
    }),
    'alert_d': _parse_profile('ALERT_D', {
        'type': 'balance',
        'atr_k': 2.0,
        'time_exit_min': 10,
        'time_exit_min_roi': TIME_EXIT_MIN_ROI_DEFAULT,
        'partial_tp_r': 1.5,
        'partial_tp_ratio': 0.20,
        'structure_lookback': 7,
        'entry_stop_loss_pct': ENTRY_STOP_LOSS_PCT,
        'roi_tp_stage_thresholds': ROI_TP_STAGE_THRESHOLDS,
        'roi_tp_stage_partial_ratios': ROI_TP_STAGE_PARTIAL_RATIOS,
        'roi_stop_lock_levels': ROI_STOP_LOCK_LEVELS,
    }),
}


class PositionLifecycleEngine:
    def __init__(self):
        self._ensure_table()

    def _conn(self):
        conn = sqlite3.connect(_DB_PATH)
        conn.execute('PRAGMA journal_mode=WAL')
        return conn

    def _ensure_table(self):
        conn = self._conn()
        conn.execute(
            'CREATE TABLE IF NOT EXISTS bot_lifecycle_state ('
            '  state_key TEXT PRIMARY KEY,'
            '  symbol TEXT NOT NULL,'
            '  bot_name TEXT NOT NULL,'
            '  side TEXT NOT NULL,'
            '  entry_price REAL NOT NULL,'
            '  initial_sl REAL NOT NULL,'
            '  opened_at INTEGER NOT NULL,'
            '  partial_taken INTEGER NOT NULL DEFAULT 0,'
            '  partial_stage INTEGER NOT NULL DEFAULT 0,'
            '  entry_context TEXT NOT NULL DEFAULT "{}",'
            '  updated_at INTEGER NOT NULL'
            ')'
        )
        try:
            conn.execute('ALTER TABLE bot_lifecycle_state ADD COLUMN partial_stage INTEGER NOT NULL DEFAULT 0')
        except Exception:
            pass
        try:
            conn.execute('ALTER TABLE bot_lifecycle_state ADD COLUMN weak_bos_count INTEGER NOT NULL DEFAULT 0')
        except Exception:
            pass
        conn.commit()
        conn.close()

    def _state_key(self, symbol: str, bot_name: str, side: str) -> str:
        return f'{symbol}:{bot_name}:{side}'

    def _get_state(self, symbol: str, bot_name: str, side: str):
        conn = self._conn()
        cur = conn.cursor()
        cur.execute(
            'SELECT entry_price, initial_sl, opened_at, partial_taken, partial_stage, entry_context, weak_bos_count '
            'FROM bot_lifecycle_state WHERE state_key = ?',
            (self._state_key(symbol, bot_name, side),),
        )
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        return {
            'entry_price': float(row[0]),
            'initial_sl': float(row[1]),
            'opened_at': int(row[2]),
            'partial_taken': bool(row[3]),
            'partial_stage': int(row[4] or 0),
            'entry_context': json.loads(row[5] or '{}'),
            'weak_bos_count': int(row[6] or 0),
        }

    def _upsert_state(self, symbol: str, bot_name: str, side: str, entry_price: float, initial_sl: float, entry_context: dict):
        now_ts = int(time.time())
        conn = self._conn()
        conn.execute(
            'INSERT OR IGNORE INTO bot_lifecycle_state '
            '(state_key, symbol, bot_name, side, entry_price, initial_sl, opened_at, partial_taken, partial_stage, entry_context, updated_at) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)',
            (
                self._state_key(symbol, bot_name, side), symbol, bot_name, side,
                float(entry_price), float(initial_sl), now_ts,
                json.dumps(entry_context or {}, ensure_ascii=False), now_ts,
            ),
        )
        conn.execute(
            'UPDATE bot_lifecycle_state SET updated_at = ? WHERE state_key = ?',
            (now_ts, self._state_key(symbol, bot_name, side)),
        )
        conn.commit()
        conn.close()

    def set_partial_taken(self, symbol: str, bot_name: str, side: str):
        conn = self._conn()
        conn.execute(
            'UPDATE bot_lifecycle_state SET partial_taken = 1, partial_stage = CASE WHEN partial_stage < 1 THEN 1 ELSE partial_stage END, updated_at = ? WHERE state_key = ?',
            (int(time.time()), self._state_key(symbol, bot_name, side)),
        )
        conn.commit()
        conn.close()

    def set_partial_stage(self, symbol: str, bot_name: str, side: str, stage: int):
        conn = self._conn()
        conn.execute(
            'UPDATE bot_lifecycle_state SET partial_taken = 1, partial_stage = CASE WHEN partial_stage < ? THEN ? ELSE partial_stage END, updated_at = ? WHERE state_key = ?',
            (int(stage), int(stage), int(time.time()), self._state_key(symbol, bot_name, side)),
        )
        conn.commit()
        conn.close()

    def set_weak_bos_count(self, symbol: str, bot_name: str, side: str, weak_bos_count: int):
        conn = self._conn()
        conn.execute(
            'UPDATE bot_lifecycle_state SET weak_bos_count = ?, updated_at = ? WHERE state_key = ?',
            (max(0, int(weak_bos_count)), int(time.time()), self._state_key(symbol, bot_name, side)),
        )
        conn.commit()
        conn.close()

    def _roi_stage_target(self, roi: float, stage_thresholds: list[float]) -> int:
        stage = 0
        for idx, threshold in enumerate(stage_thresholds, start=1):
            if roi >= float(threshold):
                stage = idx
        return stage

    def _dynamic_stop_lock_price(self, side: str, entry_price: float, roi: float, stage_thresholds: list[float], stop_lock_levels: list[float]):
        if entry_price <= 0:
            return None, 0.0

        lock_roi = 0.0
        for threshold, lock in zip(stage_thresholds, stop_lock_levels):
            if roi >= float(threshold):
                lock_roi = max(lock_roi, float(lock))

        if lock_roi <= 0:
            return None, 0.0

        if side == 'long':
            return entry_price * (1.0 + lock_roi), lock_roi
        return entry_price * (1.0 - lock_roi), lock_roi

    def clear_state(self, symbol: str, bot_name: str, side: str):
        conn = self._conn()
        conn.execute('DELETE FROM bot_lifecycle_state WHERE state_key = ?', (self._state_key(symbol, bot_name, side),))
        conn.commit()
        conn.close()

    def get_tracked_bot_name(self, symbol: str, side: str) -> str | None:
        conn = self._conn()
        cur = conn.cursor()
        cur.execute(
            'SELECT bot_name FROM bot_lifecycle_state WHERE symbol = ? AND side = ? ORDER BY updated_at DESC LIMIT 1',
            (str(symbol or ''), str(side or '').lower()),
        )
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        bot_name = str(row[0] or '').strip()
        return bot_name if bot_name else None

    def evaluate(self, symbol: str, bot_name: str, position: dict, atr_value: float = None, structure_stop: float = None, entry_context: dict = None, volume_drop: bool = False, atr_expanding: bool = False) -> dict:
        profile = BOT_PROFILES.get(bot_name, BOT_PROFILES['alert_d'])
        stage_thresholds = list(profile.get('roi_tp_stage_thresholds') or ROI_TP_STAGE_THRESHOLDS)
        stage_partial_ratios = list(profile.get('roi_tp_stage_partial_ratios') or ROI_TP_STAGE_PARTIAL_RATIOS)
        stop_lock_levels = list(profile.get('roi_stop_lock_levels') or ROI_STOP_LOCK_LEVELS)
        entry_stop_loss_pct = max(0.001, min(0.95, float(profile.get('entry_stop_loss_pct', ENTRY_STOP_LOSS_PCT))))
        side = str(position.get('holdSide', '')).lower()
        mark_price = float(position.get('markPrice', 0) or 0)
        entry_price = float(position.get('openPriceAvg') or position.get('avgOpenPrice') or 0)
        if mark_price <= 0 or entry_price <= 0 or side not in ('long', 'short'):
            return {'action': 'hold', 'reason': 'invalid_position', 'confidence': 0.0}

        atr = float(atr_value or 0.0)
        atr_ratio = (atr / entry_price) if atr > 0 and entry_price > 0 else 0.0
        if side == 'long':
            initial_sl = entry_price * (1.0 - entry_stop_loss_pct)
            roi = (mark_price - entry_price) / entry_price
        else:
            initial_sl = entry_price * (1.0 + entry_stop_loss_pct)
            roi = (entry_price - mark_price) / entry_price

        self._upsert_state(symbol, bot_name, side, entry_price, initial_sl, entry_context or {})
        state = self._get_state(symbol, bot_name, side)
        if not state:
            return {'action': 'hold', 'reason': 'state_missing', 'confidence': 0.0}

        hard_sl = float(state['initial_sl'])
        if side == 'long' and mark_price <= hard_sl:
            return {'action': 'close', 'reason': 'hard_sl_hit', 'confidence': 1.0, 'roi': roi}
        if side == 'short' and mark_price >= hard_sl:
            return {'action': 'close', 'reason': 'hard_sl_hit', 'confidence': 1.0, 'roi': roi}

        if bool(volume_drop) and roi < MOMENTUM_KILL_ROI_MAX:
            return {'action': 'close', 'reason': 'momentum_kill_volume_drop', 'confidence': 0.88, 'roi': roi}

        structure = self._evaluate_structure_break(position, profile)
        weak_bos_count = int(state.get('weak_bos_count', 0) or 0)
        if structure.get('weak_signal'):
            weak_bos_count += 1
        else:
            weak_bos_count = 0
        self.set_weak_bos_count(symbol, bot_name, side, weak_bos_count)

        current_stage = int(state.get('partial_stage', 0) or 0)
        target_stage = self._roi_stage_target(roi, stage_thresholds)
        if target_stage > current_stage:
            ratio_idx = min(target_stage - 1, max(0, len(stage_partial_ratios) - 1))
            partial_ratio = max(0.0, min(0.95, float(stage_partial_ratios[ratio_idx])))
            return {
                'action': 'partial',
                'reason': f'roi_stage_tp_s{target_stage}',
                'confidence': 0.92,
                'partial_ratio': partial_ratio,
                'partial_stage_target': int(target_stage),
                'roi': roi,
            }

        elapsed_min = max(0.0, (int(time.time()) - int(state['opened_at'])) / 60.0)
        trend_cont = self._trend_continuation_ok(position, side, roi)
        effective_time_exit_min = float(profile['time_exit_min'])
        if bool(state.get('partial_taken')) or int(state.get('partial_stage', 0) or 0) > 0:
            effective_time_exit_min = effective_time_exit_min * max(1.0, POST_PARTIAL_TIME_EXIT_MULTIPLIER)
        if profile.get('type') == 'trend' and trend_cont:
            effective_time_exit_min = effective_time_exit_min * float(os.getenv('TREND_TIME_EXIT_EXTENSION', '1.6'))

        min_roi_threshold = float(profile.get('time_exit_min_roi', TIME_EXIT_MIN_ROI_DEFAULT))
        if elapsed_min >= effective_time_exit_min and roi < min_roi_threshold:
            return {'action': 'close', 'reason': f'time_decay_exit_{int(elapsed_min)}m', 'confidence': 0.86, 'roi': roi}

        hybrid_stop = None
        if structure_stop is not None:
            if side == 'long':
                hybrid_stop = max(float(structure_stop), hard_sl)
            else:
                hybrid_stop = min(float(structure_stop), hard_sl)

        lock_stop, lock_roi = self._dynamic_stop_lock_price(
            side=side,
            entry_price=entry_price,
            roi=roi,
            stage_thresholds=stage_thresholds,
            stop_lock_levels=stop_lock_levels,
        )
        if lock_stop is not None:
            if side == 'long':
                hybrid_stop = max(float(hybrid_stop or hard_sl), float(lock_stop))
            else:
                hybrid_stop = min(float(hybrid_stop or hard_sl), float(lock_stop))

        return {
            'action': 'hold',
            'reason': 'hold_trend_continuation' if (profile.get('type') == 'trend' and trend_cont) else 'hold',
            'confidence': 0.0,
            'roi': roi,
            'runner_mode': bool(roi >= RUNNER_MODE_ROI),
            'structure_exit': bool(weak_bos_count >= STRUCTURE_WEAK_BOS_CLOSE_COUNT or structure.get('breakdown')),
            'structure_reason': 'consecutive_weak_bos' if weak_bos_count >= STRUCTURE_WEAK_BOS_CLOSE_COUNT else (structure.get('reason') if structure.get('breakdown') else 'structure_ok'),
            'consecutive_weak_bos': weak_bos_count,
            'volume_drop': bool(volume_drop),
            'atr_expanding': bool(atr_expanding),
            'hard_sl': hard_sl,
            'hybrid_stop': hybrid_stop,
            'roi_stop_lock': lock_roi,
            'entry_stop_loss_pct': entry_stop_loss_pct,
            'entry_context': state.get('entry_context', {}),
        }

    def _trend_continuation_ok(self, position: dict, side: str, roi: float) -> bool:
        change_24h = float(position.get('change24h', 0) or 0)
        funding_rate = float(position.get('fundingRate', 0) or 0)

        trend_sign_ok = False
        if side == 'long':
            trend_sign_ok = (change_24h >= 0.2) or (roi > 0.0002)
        elif side == 'short':
            trend_sign_ok = (change_24h <= -0.2) or (roi > 0.0002)

        funding_ok = True
        if side == 'long' and funding_rate > 0.002:
            funding_ok = False
        if side == 'short' and funding_rate < -0.002:
            funding_ok = False

        return bool(trend_sign_ok and funding_ok)

    def _evaluate_structure_break(self, position: dict, profile: dict) -> dict:
        close_price = float(position.get('markPrice', 0) or 0)
        low = float(position.get('low24h', 0) or 0)
        high = float(position.get('high24h', 0) or 0)
        side = str(position.get('holdSide', '')).lower()
        volume_24h = float(position.get('baseVolume', 0) or 0)

        if side == 'long' and low > 0 and close_price <= low * 1.001:
            return {'breakdown': True, 'weak_signal': True, 'reason': 'bos_invalidated_long'}
        if side == 'short' and high > 0 and close_price >= high * 0.999:
            return {'breakdown': True, 'weak_signal': True, 'reason': 'bos_invalidated_short'}

        if side == 'long' and low > 0 and close_price <= low * 1.003:
            return {'breakdown': False, 'weak_signal': True, 'reason': 'bos_weakened_long'}
        if side == 'short' and high > 0 and close_price >= high * 0.997:
            return {'breakdown': False, 'weak_signal': True, 'reason': 'bos_weakened_short'}

        if volume_24h > 0 and volume_24h < 1:
            return {'breakdown': True, 'weak_signal': True, 'reason': 'volume_disappeared'}

        return {'breakdown': False, 'weak_signal': False, 'reason': 'structure_ok'}


def build_entry_context(regime: str, signal: str, volatility: str, liquidity: str, score: float = 0.0, confidence: float = 0.0) -> dict:
    return {
        'regime': regime,
        'signal': signal,
        'volatility': volatility,
        'liquidity': liquidity,
        'score': float(score),
        'confidence': float(confidence),
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
