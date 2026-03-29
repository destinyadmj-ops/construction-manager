from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass

from bot_v2.position.position_registry import PositionRegistry


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _normalize_side(value: str | None) -> str:
    side = str(value or '').strip().lower()
    if side in ('buy', 'long', 'open_long'):
        return 'buy'
    if side in ('sell', 'short', 'open_short'):
        return 'sell'
    return 'buy'


@dataclass(slots=True)
class Position:
    symbol: str
    strategy: str
    side: str
    entry_price: float
    size: float
    initial_size: float = 0.0
    timestamp: float = 0.0
    max_profit: float = 0.0
    unrealized_pnl: float = 0.0
    partial_taken: list[bool] | None = None
    closed: bool = False
    trade_id: int | None = None
    position_id: str = ''

    def __post_init__(self):
        self.symbol = str(self.symbol or '').upper()
        self.strategy = str(self.strategy or 'alert_d').strip().lower()
        self.side = _normalize_side(self.side)
        self.entry_price = _safe_float(self.entry_price, 0.0)
        self.size = max(0.0, _safe_float(self.size, 0.0))
        self.initial_size = max(self.size, _safe_float(self.initial_size, self.size))
        self.timestamp = _safe_float(self.timestamp, time.time())
        self.max_profit = _safe_float(self.max_profit, 0.0)
        self.unrealized_pnl = _safe_float(self.unrealized_pnl, 0.0)
        taken = self.partial_taken if isinstance(self.partial_taken, list) else [False, False, False]
        normalized = [bool(item) for item in taken[:3]]
        while len(normalized) < 3:
            normalized.append(False)
        self.partial_taken = normalized

    @classmethod
    def from_registry_dict(cls, row: dict):
        entry_context = dict(row.get('entry_context') or {})
        return cls(
            symbol=str(row.get('symbol') or ''),
            strategy=str(row.get('strategy') or 'alert_d'),
            side=str(row.get('side') or 'buy'),
            entry_price=_safe_float(row.get('entry_price'), 0.0),
            size=_safe_float(row.get('size'), 0.0),
            initial_size=_safe_float(entry_context.get('initial_size'), _safe_float(row.get('size'), 0.0)),
            timestamp=_safe_float(row.get('timestamp'), time.time()),
            max_profit=_safe_float(row.get('max_profit'), 0.0),
            unrealized_pnl=_safe_float(row.get('unrealized_pnl'), 0.0),
            partial_taken=list(entry_context.get('partial_taken') or [False, False, False]),
            closed=str(row.get('status') or 'open') != 'open',
            trade_id=int(row.get('trade_id') or 0) or None,
            position_id=str(row.get('position_id') or ''),
        )


class PositionManager:
    def __init__(self, filepath: str | None = None, use_registry: bool = True):
        self.filepath = filepath or os.getenv('POSITION_REGISTRY_PATH', 'bot_v2/data/positions.json')
        self._use_registry = bool(use_registry)
        self._registry = PositionRegistry(store_path=self.filepath) if self._use_registry else None
        self.positions: list[Position] = []
        self._load()

    def add(self, pos: Position):
        if self._use_registry and self._registry is not None:
            position_id = self._registry.add(
                symbol=pos.symbol,
                strategy=pos.strategy,
                side=pos.side,
                entry_price=pos.entry_price,
                size=pos.size,
                entry_context={
                    'initial_size': pos.initial_size,
                    'partial_taken': list(pos.partial_taken or [False, False, False]),
                },
            )
            pos.position_id = position_id
            self._load()
            return
        self.positions.append(pos)
        self._save()

    def remove(self, pos: Position):
        if self._use_registry and self._registry is not None:
            if pos.trade_id:
                self._registry.close_trade(pos.trade_id)
            else:
                self._registry.close(symbol=pos.symbol, strategy=pos.strategy, side=pos.side)
            self._load()
            return
        self.positions = [p for p in self.positions if p != pos]
        self._save()

    def get_all(self):
        if self._use_registry and self._registry is not None:
            self._load()
        return self.positions

    def update_pnl(self, price_map: dict):
        updated = []
        for pos in self.positions:
            if pos.symbol not in price_map:
                continue
            current = _safe_float(price_map[pos.symbol], 0.0)
            if current <= 0:
                continue
            if pos.side == 'buy':
                pnl = (current - pos.entry_price) * pos.size
            else:
                pnl = (pos.entry_price - current) * pos.size

            pos.unrealized_pnl = pnl
            pos.max_profit = max(pos.max_profit, pnl)
            updated.append(pos)

            if self._use_registry and self._registry is not None:
                self._registry.sync_live_position(
                    symbol=pos.symbol,
                    strategy=pos.strategy,
                    side=pos.side,
                    entry_price=pos.entry_price,
                    size=pos.size,
                    mark_price=current,
                    unrealized_pnl=pnl,
                    entry_context={
                        'initial_size': pos.initial_size,
                        'partial_taken': list(pos.partial_taken or [False, False, False]),
                    },
                )

        if not self._use_registry:
            self._save()
        return updated

    def reduce(self, pos: Position, closed_size: float, partial_index: int | None = None):
        # No positionエラー防止: 存在確認
        if not any(p.symbol == pos.symbol and p.side == pos.side and not getattr(p, 'closed', False) for p in self.get_all()):
            return False
        reduce_size = max(0.0, min(pos.size, _safe_float(closed_size, 0.0)))
        if reduce_size <= 0:
            return False

        pos.size = max(0.0, pos.size - reduce_size)
        if partial_index is not None and 0 <= int(partial_index) < len(pos.partial_taken or []):
            pos.partial_taken[int(partial_index)] = True

        if self._use_registry and self._registry is not None:
            if pos.trade_id:
                self._registry.reduce(pos.trade_id, reduce_size)
            self._registry.sync_live_position(
                symbol=pos.symbol,
                strategy=pos.strategy,
                side=pos.side,
                entry_price=pos.entry_price,
                size=pos.size,
                unrealized_pnl=pos.unrealized_pnl,
                entry_context={
                    'initial_size': pos.initial_size,
                    'partial_taken': list(pos.partial_taken or [False, False, False]),
                },
            )
            if pos.size <= 0:
                self.remove(pos)
            else:
                self._load()
            return True

        if pos.size <= 0:
            self.remove(pos)
        else:
            self._save()
        return True

    def _save(self):
        if self._use_registry:
            return
        data = [asdict(p) for p in self.positions]
        parent = os.path.dirname(self.filepath)
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp_path = f'{self.filepath}.tmp'
        with open(tmp_path, 'w', encoding='utf-8') as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        os.replace(tmp_path, self.filepath)

    def _load(self):
        if self._use_registry and self._registry is not None:
            rows = self._registry.get_all()
            self.positions = [Position.from_registry_dict(row) for row in rows]
            return

        if not os.path.exists(self.filepath):
            self.positions = []
            return

        try:
            with open(self.filepath, 'r', encoding='utf-8') as handle:
                loaded = json.load(handle)
        except Exception:
            self.positions = []
            return

        if not isinstance(loaded, list):
            self.positions = []
            return

        self.positions = []
        for row in loaded:
            if not isinstance(row, dict):
                continue
            self.positions.append(
                Position(
                    symbol=str(row.get('symbol') or ''),
                    strategy=str(row.get('strategy') or 'alert_d'),
                    side=str(row.get('side') or 'buy'),
                    entry_price=_safe_float(row.get('entry_price'), 0.0),
                    size=_safe_float(row.get('size'), 0.0),
                    initial_size=_safe_float(row.get('initial_size'), _safe_float(row.get('size'), 0.0)),
                    timestamp=_safe_float(row.get('timestamp'), time.time()),
                    max_profit=_safe_float(row.get('max_profit'), 0.0),
                    unrealized_pnl=_safe_float(row.get('unrealized_pnl'), 0.0),
                    partial_taken=list(row.get('partial_taken') or [False, False, False]),
                    closed=bool(row.get('closed', False)),
                    trade_id=int(row.get('trade_id') or 0) or None,
                    position_id=str(row.get('position_id') or ''),
                )
            )