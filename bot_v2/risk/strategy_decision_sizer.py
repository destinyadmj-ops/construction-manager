from __future__ import annotations


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


class StrategyDecisionSizer:
    def __init__(
        self,
        strategy_multiplier_resolver,
        result_recorder,
        strategy_name_normalizer,
        entry_margin_balance_pct: float,
        order_size_scale: float = 1.0,
    ):
        self._strategy_multiplier_resolver = strategy_multiplier_resolver
        self._result_recorder = result_recorder
        self._strategy_name_normalizer = strategy_name_normalizer
        self._entry_margin_balance_pct = max(0.0, min(1.0, _safe_float(entry_margin_balance_pct, 0.0)))
        self._order_size_scale = max(0.0, _safe_float(order_size_scale, 1.0))

    def get_position_size(self, strategy_name: str, balance: float, mark_price: float, leverage: float) -> dict:
        normalized_strategy = self._strategy_name_normalizer(strategy_name)
        effective_balance = _safe_float(balance, 0.0)
        mark = _safe_float(mark_price, 0.0)
        lev = max(1.0, _safe_float(leverage, 1.0))
        target_margin = effective_balance * self._entry_margin_balance_pct
        base_size = (target_margin * lev / mark) if mark > 0 and target_margin > 0 else 0.0
        strategy_multiplier = _safe_float(self._strategy_multiplier_resolver(normalized_strategy), 1.0)
        final_size = base_size * strategy_multiplier * self._order_size_scale
        return {
            'strategy_name': normalized_strategy,
            'balance': effective_balance,
            'mark_price': mark,
            'leverage': lev,
            'entry_margin_balance_pct': self._entry_margin_balance_pct,
            'target_margin_notional': target_margin,
            'base_size': base_size,
            'strategy_multiplier': strategy_multiplier,
            'order_size_scale': self._order_size_scale,
            'size': final_size,
        }

    def update_result(self, strategy_name: str, profit: float, roi: float | None = None) -> None:
        self._result_recorder(self._strategy_name_normalizer(strategy_name), _safe_float(profit, 0.0), roi=roi)