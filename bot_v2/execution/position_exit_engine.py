"""PositionExitEngine — simplified, single implementation.

This file provides a single, importable `PositionExitEngine` that is
config-driven. It reads `DYNAMIC_SL_THRESHOLDS` from `bot_v2.config` at
evaluation time. The implementation keeps side-effects minimal to avoid
mutating `Position` objects that may use `__slots__`.
"""

from __future__ import annotations

from typing import List, Tuple
import bot_v2.config as cfg
from bot_v2.strategy.position_lifecycle_engine import PositionLifecycleEngine


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


class PositionExitEngine:
    def __init__(self):
        self.lifecycle = PositionLifecycleEngine()

    def _compute_trail(self, profit: float, atr: float, price: float) -> float:
        base = getattr(cfg, 'VOLATILITY_TRAILING_ATR_MULTIPLIER', 2.0)
        if profit < 0.01:
            mult = base * 1.25
        elif profit < 0.02:
            mult = base * 1.0
        else:
            mult = base * 0.6
        # If atr is not provided or non-positive, fallback to a small pct of price
        try:
            atr_val = float(atr)
        except Exception:
            atr_val = 0.0
        if atr_val <= 0:
            atr_val = max(1e-8, float(price) * 0.005)
        return atr_val * mult

    def update_trailing(self, position, price: float, atr: float) -> float:
        entry = _safe_float(getattr(position, 'entry_price', 0.0), 0.0)
        profit = (price - entry) / (entry or 1.0)
        side_val = str(getattr(position, 'side', 'buy') or 'buy').lower()
        trail = self._compute_trail(profit, atr, price)
        new_stop = price - trail if side_val in ("buy", "long") else price + trail
        try:
            cur = getattr(position, 'trailing_stop', None)
            if cur is None or (
                side_val in ("buy", "long") and new_stop > cur
            ) or (
                side_val in ("sell", "short") and new_stop < cur
            ):
                try:
                    position.trailing_stop = new_stop
                except Exception:
                    pass
        except Exception:
            pass
        return new_stop

    def handle_partial(self, position, price: float) -> List[Tuple[str, float]]:
        results: List[Tuple[str, float]] = []
        try:
            tp1 = getattr(position, 'tp1_done', False)
            tp2 = getattr(position, 'tp2_done', False)
            entry = _safe_float(getattr(position, 'entry_price', 0.0), 0.0)
            size = _safe_float(getattr(position, 'size', 0.0), 0.0)
            if not tp1 and entry > 0 and price >= entry * 1.01:
                close_size = size * 0.3
                try:
                    position.tp1_done = True
                except Exception:
                    pass
                results.append(("partial", close_size))
            if not tp2 and entry > 0 and price >= entry * 1.02:
                close_size = size * 0.3
                try:
                    position.tp2_done = True
                except Exception:
                    pass
                results.append(("partial", close_size))
        except Exception:
            pass
        return results

    class ExitEngine:
        @staticmethod
        def evaluate(position, price: float, indicators: dict) -> str:
            try:
                pnl = (price - position.entry_price) / position.entry_price if position.entry_price > 0 else 0.0
            except Exception:
                pnl = 0.0
            if pnl <= -0.20:
                return "hard_stop"
            if pnl < 0 and indicators.get("micro_reversal"):
                return "exit"
            if pnl < 0.01 and indicators.get("trend_weak"):
                return "exit_partial"
            ts = getattr(position, 'trailing_stop', None)
            if ts is not None:
                if getattr(position, 'side', 'buy') in ('buy', 'long') and price < ts:
                    return 'exit_all'
                if getattr(position, 'side', 'buy') in ('sell', 'short') and price > ts:
                    return 'exit_all'
            return 'hold'

    def evaluate_detail(self, pos, price: float) -> dict:
        entry = _safe_float(getattr(pos, 'entry_price', 0.0), 0.0)
        size = _safe_float(getattr(pos, 'size', 0.0), 0.0)
        if entry <= 0 or size <= 0:
            return {'actions': [], 'reason': 'invalid'}

        side = str(getattr(pos, 'side', 'buy') or 'buy').lower()
        try:
            roi = (entry - price) / entry if side in ('sell', 'short') else (price - entry) / entry
        except Exception:
            roi = 0.0

        # trailing using ATR if available
        # Use provided ATR if available; avoid accidentally using the ATR-multiplier as ATR
        atr_raw = getattr(pos, 'atr', None)
        atr = _safe_float(atr_raw, 0.0)
        self.update_trailing(pos, price, atr)

        actions: List[Tuple[str, float]] = []
        reasons: List[str] = []

        # partials
        for act in self.handle_partial(pos, price):
            actions.append(act)
            reasons.append('partial_tp')

        # phase exit
        indicators = {
            'micro_reversal': getattr(pos, 'micro_reversal', False),
            'trend_weak': getattr(pos, 'trend_weak', False),
        }
        phase = self.ExitEngine.evaluate(pos, price, indicators)
        if phase in ('hard_stop', 'exit', 'exit_all'):
            actions.append(('close', 1.0))
            reasons.append(phase)
        elif phase == 'exit_partial':
            actions.append(('partial', 0.3))
            reasons.append('phase_partial')

        # dynamic SL from config (list of (min_roi, sl_pct)), evaluated in order
        dynamic_sl = 0.20
        for thr, sl in getattr(cfg, 'DYNAMIC_SL_THRESHOLDS', [(0.8, 0.10), (0.5, 0.15), (0.0, 0.20)]):
            try:
                if roi >= float(thr):
                    dynamic_sl = float(sl)
                    break
            except Exception:
                continue

        try:
            if side in ('sell', 'short'):
                sl_price = entry * (1.0 + dynamic_sl)
                if price >= sl_price:
                    actions.append(('close', 1.0))
                    reasons.append('dynamic_sl_hit')
            else:
                sl_price = entry * (1.0 - dynamic_sl)
                if price <= sl_price:
                    actions.append(('close', 1.0))
                    reasons.append('dynamic_sl_hit')
        except Exception:
            pass

        unrealized_pnl = (price - entry) * size if side in ('buy', 'long') else (entry - price) * size

        return {
            'actions': actions,
            'reason': ','.join(reasons) if reasons else 'hold',
            'unrealized_pnl': unrealized_pnl,
        }

    def evaluate(self, pos, price: float):
        return self.evaluate_detail(pos, price).get('actions', [])
