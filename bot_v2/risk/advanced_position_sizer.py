from __future__ import annotations

import math
import statistics


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


class StrategyStats:
    def __init__(self, max_samples: int = 200):
        self.max_samples = max(10, int(max_samples))
        self.returns: list[float] = []

    def update(self, value: float) -> None:
        self.returns.append(_safe_float(value, 0.0))
        if len(self.returns) > self.max_samples:
            self.returns.pop(0)

    def sharpe(self) -> float:
        if len(self.returns) < 5:
            return 0.0
        mean = statistics.fmean(self.returns)
        volatility = statistics.pstdev(self.returns)
        return mean / (volatility + 1e-6)



class AdvancedPositionSizer:
    """
    高度なポジションサイザー: 各戦略のリターン履歴・シャープレシオ・RLバイアスを考慮し、
    config/envからパラメータを自動取得して資金配分を最適化する。
    
    Args:
        base_risk (float): 1トレードあたりのリスク（例: 0.01=1%）
        min_alloc (float): 各戦略の最小配分
        max_alloc (float): 各戦略の最大配分
    """
    def __init__(self, base_risk: float = None, min_alloc: float = None, max_alloc: float = None):
        import os
        from bot_v2 import config
        def _envfloat(key, default):
            try:
                return float(os.getenv(key, getattr(config, key, default)))
            except Exception:
                return default
        self.base_risk = max(0.0, _safe_float(base_risk if base_risk is not None else _envfloat('RISK_PER_TRADE', 0.01), 0.01))
        self.min_alloc = max(0.0, min(1.0, _safe_float(min_alloc if min_alloc is not None else _envfloat('ADVANCED_SIZER_MIN_ALLOC', 0.10), 0.10)))
        self.max_alloc = max(self.min_alloc, min(1.0, _safe_float(max_alloc if max_alloc is not None else _envfloat('ADVANCED_SIZER_MAX_ALLOC', 0.55), 0.55)))
        self.stats: dict[str, StrategyStats] = {}

    def register(self, name: str) -> None:
        key = str(name or '').strip().lower()
        if key and key not in self.stats:
            self.stats[key] = StrategyStats()

    def update(self, name: str, profit: float, balance: float | None = None) -> None:
        key = str(name or '').strip().lower()
        self.register(key)
        base = max(abs(_safe_float(balance, 0.0)), 1.0)
        normalized_return = _safe_float(profit, 0.0) / base
        self.stats[key].update(normalized_return)

    def weight(self, name: str, rl_bias: float = 1.0) -> float:
        key = str(name or '').strip().lower()
        self.register(key)
        sharpe = self.stats[key].sharpe()
        capped_sharpe = max(-2.0, min(2.0, sharpe))
        bias = max(0.5, min(1.5, _safe_float(rl_bias, 1.0)))
        return math.exp(capped_sharpe) * bias

    def allocation(self, name: str, rl_bias_map: dict[str, float] | None = None) -> dict[str, float]:
        if not self.stats:
            self.register(str(name or 'alert_d'))
        biases = {key: max(0.5, min(1.5, _safe_float((rl_bias_map or {}).get(key, 1.0), 1.0))) for key in self.stats}
        weights = {key: self.weight(key, biases.get(key, 1.0)) for key in self.stats}
        total = sum(weights.values())
        raw = (weights.get(str(name or '').strip().lower(), 0.0) / total) if total > 0 else 0.25
        bounded = max(self.min_alloc, min(self.max_alloc, raw))
        return {
            'weight': weights.get(str(name or '').strip().lower(), 0.0),
            'raw_allocation': raw,
            'allocation': bounded,
            'weights': weights,
        }

    def get_size(self, name: str, balance: float, rl_bias_map: dict[str, float] | None = None) -> dict[str, float]:
        effective_balance = max(0.0, _safe_float(balance, 0.0))
        alloc = self.allocation(name, rl_bias_map=rl_bias_map)
        risk_budget = effective_balance * self.base_risk
        return {
            'strategy_name': str(name or '').strip().lower(),
            'balance': effective_balance,
            'base_risk': self.base_risk,
            'allocation': alloc['allocation'],
            'raw_allocation': alloc['raw_allocation'],
            'risk_budget': risk_budget,
            'size': risk_budget * alloc['allocation'],
            'weights': alloc['weights'],
        }