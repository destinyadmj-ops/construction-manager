from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from pathlib import Path


_ALLOWED_STRATEGIES = {'alert_a', 'alert_b', 'alert_c', 'alert_d'}


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _normalize_strategy_name(value: str | None) -> str:
    strategy = str(value or 'alert_d').strip().lower()
    return strategy if strategy in _ALLOWED_STRATEGIES else 'alert_d'


def _normalize_side(value: str | None) -> str | None:
    side = str(value or '').strip().lower()
    if side in ('buy', 'long', 'open_long'):
        return 'buy'
    if side in ('sell', 'short', 'open_short'):
        return 'sell'
    return None


@dataclass(slots=True)
class Position:
    position_id: str
    trade_id: int
    symbol: str
    strategy: str
    side: str
    entry_price: float
    size: float
    timestamp: int
    unrealized_pnl: float = 0.0
    max_profit: float = 0.0
    lifecycle_stage: str = 'entry'
    mark_price: float = 0.0
    confidence: float = 0.0
    score: float = 0.0
    source: str = 'webhook_v2'
    order_id: str = ''
    status: str = 'open'
    updated_at: int = 0
    closed_at: int | None = None
    realized_pnl: float | None = None
    entry_context: dict = field(default_factory=dict)
    decision: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


class _LockFile:
    def __init__(self, lock_path: Path, timeout_seconds: float = 5.0):
        self._lock_path = lock_path
        self._timeout_seconds = max(0.1, float(timeout_seconds))
        self._fd: int | None = None

    def __enter__(self):
        deadline = time.time() + self._timeout_seconds
        self._lock_path.parent.mkdir(parents=True, exist_ok=True)
        while True:
            try:
                self._fd = os.open(str(self._lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
                return self
            except FileExistsError:
                if time.time() >= deadline:
                    raise TimeoutError(f'position registry lock timeout: {self._lock_path}')
                time.sleep(0.05)

    def __exit__(self, exc_type, exc, tb):
        if self._fd is not None:
            os.close(self._fd)
            self._fd = None
        try:
            self._lock_path.unlink(missing_ok=True)
        except Exception:
            pass


class PositionRegistry:
    def __init__(self, store_path: str | None = None):
        target = store_path or os.getenv('POSITION_REGISTRY_PATH', 'bot_v2/data/positions.json')
        self.store_path = Path(target)
        self.lock_path = self.store_path.with_suffix(self.store_path.suffix + '.lock')

    def _default_state(self) -> dict:
        return {'positions': [], 'updated_at': 0}

    def _load_state_unlocked(self) -> dict:
        if not self.store_path.exists():
            return self._default_state()
        try:
            with self.store_path.open('r', encoding='utf-8') as handle:
                loaded = json.load(handle)
        except Exception:
            return self._default_state()
        if not isinstance(loaded, dict):
            return self._default_state()
        loaded.setdefault('positions', [])
        loaded.setdefault('updated_at', 0)
        return loaded

    def _save_state_unlocked(self, state: dict) -> None:
        self.store_path.parent.mkdir(parents=True, exist_ok=True)
        state['updated_at'] = int(time.time())
        tmp_path = self.store_path.with_suffix(self.store_path.suffix + '.tmp')
        with tmp_path.open('w', encoding='utf-8') as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
        os.replace(tmp_path, self.store_path)

    @contextmanager
    def _locked_state(self):
        with _LockFile(self.lock_path):
            state = self._load_state_unlocked()
            yield state
            self._save_state_unlocked(state)

    def get_all(
        self,
        symbol: str | None = None,
        strategy: str | None = None,
        side: str | None = None,
        include_closed: bool = False,
    ) -> list[dict]:
        normalized_symbol = str(symbol or '').upper() or None
        normalized_strategy = _normalize_strategy_name(strategy) if strategy else None
        normalized_side = _normalize_side(side)
        state = self._load_state_unlocked()
        results = []
        for position in state.get('positions', []):
            if not isinstance(position, dict):
                continue
            if not include_closed and str(position.get('status') or 'open') != 'open':
                continue
            if normalized_symbol and str(position.get('symbol') or '').upper() != normalized_symbol:
                continue
            if normalized_strategy and _normalize_strategy_name(position.get('strategy')) != normalized_strategy:
                continue
            if normalized_side and _normalize_side(position.get('side')) != normalized_side:
                continue
            results.append(position)
        results.sort(key=lambda item: int(item.get('timestamp', 0) or 0))
        return results

    def latest_strategy(self, symbol: str, side: str | None = None) -> str | None:
        positions = self.get_all(symbol=symbol, side=side)
        if not positions:
            return None
        latest = max(positions, key=lambda item: int(item.get('timestamp', 0) or 0))
        return _normalize_strategy_name(latest.get('strategy'))

    def add(
        self,
        symbol: str,
        strategy: str,
        side: str,
        entry_price: float,
        size: float,
        signal_bundle: list[str] | None = None,
        rr_planned: float | None = None,
        entry_context: dict | None = None,
        decision: dict | None = None,
        order_id: str | None = None,
        source: str = 'webhook_v2',
    ) -> str:
        now_ts = int(time.time())
        normalized_symbol = str(symbol or '').upper()
        normalized_strategy = _normalize_strategy_name(strategy)
        normalized_side = _normalize_side(side) or 'buy'
        position_id = f'{normalized_symbol}:{normalized_strategy}:{normalized_side}:{now_ts}'
        record = Position(
            position_id=position_id,
            trade_id=now_ts,
            symbol=normalized_symbol,
            strategy=normalized_strategy,
            side=normalized_side,
            entry_price=_safe_float(entry_price, 0.0),
            size=_safe_float(size, 0.0),
            timestamp=now_ts,
            updated_at=now_ts,
            confidence=_safe_float((decision or {}).get('confidence'), 0.0),
            score=_safe_float((decision or {}).get('score'), 0.0),
            source=str(source or 'webhook_v2'),
            order_id=str(order_id or ''),
            entry_context=dict(entry_context or {}),
            decision=dict(decision or {}),
        )
        if signal_bundle:
            record.entry_context.setdefault('signal_bundle', list(signal_bundle))
        if rr_planned is not None:
            record.entry_context.setdefault('rr_planned', _safe_float(rr_planned, 0.0))

        with self._locked_state() as state:
            state.setdefault('positions', []).append(record.to_dict())
        return position_id

    def sync_live_position(
        self,
        symbol: str,
        strategy: str,
        side: str,
        entry_price: float,
        size: float,
        mark_price: float | None = None,
        unrealized_pnl: float | None = None,
        lifecycle_stage: str | None = None,
        entry_context: dict | None = None,
        decision: dict | None = None,
    ) -> str:
        normalized_symbol = str(symbol or '').upper()
        normalized_strategy = _normalize_strategy_name(strategy)
        normalized_side = _normalize_side(side) or 'buy'
        now_ts = int(time.time())
        with self._locked_state() as state:
            positions = state.setdefault('positions', [])
            target = None
            for position in reversed(positions):
                if str(position.get('status') or 'open') != 'open':
                    continue
                if str(position.get('symbol') or '').upper() != normalized_symbol:
                    continue
                if _normalize_strategy_name(position.get('strategy')) != normalized_strategy:
                    continue
                if _normalize_side(position.get('side')) != normalized_side:
                    continue
                target = position
                break

            if target is None:
                position_id = f'{normalized_symbol}:{normalized_strategy}:{normalized_side}:{now_ts}'
                target = Position(
                    position_id=position_id,
                    trade_id=now_ts,
                    symbol=normalized_symbol,
                    strategy=normalized_strategy,
                    side=normalized_side,
                    entry_price=_safe_float(entry_price, 0.0),
                    size=_safe_float(size, 0.0),
                    timestamp=now_ts,
                    updated_at=now_ts,
                    source='monitor_sync',
                    entry_context=dict(entry_context or {}),
                    decision=dict(decision or {}),
                ).to_dict()
                positions.append(target)

            target['entry_price'] = _safe_float(entry_price, target.get('entry_price', 0.0))
            target['size'] = _safe_float(size, target.get('size', 0.0))
            if mark_price is not None:
                target['mark_price'] = _safe_float(mark_price, target.get('mark_price', 0.0))
            if unrealized_pnl is not None:
                current_pnl = _safe_float(unrealized_pnl, 0.0)
                target['unrealized_pnl'] = current_pnl
                target['max_profit'] = max(_safe_float(target.get('max_profit'), 0.0), current_pnl)
            if lifecycle_stage:
                target['lifecycle_stage'] = str(lifecycle_stage)
            if entry_context:
                merged_context = dict(target.get('entry_context') or {})
                merged_context.update(entry_context)
                target['entry_context'] = merged_context
            if decision:
                merged_decision = dict(target.get('decision') or {})
                merged_decision.update(decision)
                target['decision'] = merged_decision
                target['confidence'] = _safe_float(merged_decision.get('confidence'), target.get('confidence', 0.0))
                target['score'] = _safe_float(merged_decision.get('score'), target.get('score', 0.0))
            target['updated_at'] = now_ts
            return str(target.get('position_id') or '')

    def close(
        self,
        symbol: str,
        strategy: str | None = None,
        side: str | None = None,
        realized_pnl: float | None = None,
    ) -> list[str]:
        normalized_symbol = str(symbol or '').upper()
        normalized_strategy = _normalize_strategy_name(strategy) if strategy else None
        normalized_side = _normalize_side(side)
        closed_ids = []
        now_ts = int(time.time())
        with self._locked_state() as state:
            for position in state.setdefault('positions', []):
                if str(position.get('status') or 'open') != 'open':
                    continue
                if str(position.get('symbol') or '').upper() != normalized_symbol:
                    continue
                if normalized_strategy and _normalize_strategy_name(position.get('strategy')) != normalized_strategy:
                    continue
                if normalized_side and _normalize_side(position.get('side')) != normalized_side:
                    continue
                position['status'] = 'closed'
                position['closed_at'] = now_ts
                position['updated_at'] = now_ts
                if realized_pnl is not None:
                    position['realized_pnl'] = _safe_float(realized_pnl, 0.0)
                closed_ids.append(str(position.get('position_id') or ''))
        return closed_ids

    def close_trade(self, trade_id: int, realized_pnl: float | None = None) -> bool:
        target_trade_id = int(trade_id)
        if target_trade_id <= 0:
            return False

        closed = False
        now_ts = int(time.time())
        with self._locked_state() as state:
            for position in state.setdefault('positions', []):
                if str(position.get('status') or 'open') != 'open':
                    continue
                if int(position.get('trade_id', 0) or 0) != target_trade_id:
                    continue
                position['status'] = 'closed'
                position['closed_at'] = now_ts
                position['updated_at'] = now_ts
                if realized_pnl is not None:
                    position['realized_pnl'] = _safe_float(realized_pnl, 0.0)
                closed = True
                break
        return closed

    def reduce(self, trade_id: int, closed_size: float) -> bool:
        target_trade_id = int(trade_id)
        reduce_size = max(0.0, _safe_float(closed_size, 0.0))
        if target_trade_id <= 0 or reduce_size <= 0:
            return False

        updated = False
        with self._locked_state() as state:
            for position in state.setdefault('positions', []):
                if str(position.get('status') or 'open') != 'open':
                    continue
                if int(position.get('trade_id', 0) or 0) != target_trade_id:
                    continue
                current_size = max(0.0, _safe_float(position.get('size'), 0.0))
                position['size'] = max(0.0, current_size - reduce_size)
                position['updated_at'] = int(time.time())
                updated = True
                break
        return updated