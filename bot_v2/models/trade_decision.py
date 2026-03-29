from __future__ import annotations

from dataclasses import asdict, dataclass


_ALLOWED_STRATEGIES = {'alert_a', 'alert_b', 'alert_c', 'alert_d'}


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def normalize_strategy_name(value: str | None) -> str:
    strategy = str(value or 'alert_d').strip().lower()
    return strategy if strategy in _ALLOWED_STRATEGIES else 'alert_d'


def normalize_trade_side(value: str | None) -> str:
    side = str(value or '').strip().upper()
    return side if side in ('BUY', 'SELL') else ''


def candidate_for_alert(candidates, alert_name: str):
    normalized = normalize_strategy_name(alert_name)
    if not isinstance(candidates, list):
        return None
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        if normalize_strategy_name(candidate.get('alert')) == normalized:
            return candidate
    return None


@dataclass(slots=True)
class TradeDecision:
    strategy: str
    side: str
    confidence: float = 0.0
    score: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


def build_trade_decision(bot_eval, signal, fallback_alert_name=None) -> dict:
    strategy = normalize_strategy_name((bot_eval or {}).get('selected_alert') or fallback_alert_name)
    candidate = candidate_for_alert((bot_eval or {}).get('candidates'), strategy) or {}
    confidence = _safe_float(candidate.get('confidence'), _safe_float((bot_eval or {}).get('confidence'), 0.0))
    score = _safe_float(candidate.get('score'), _safe_float((bot_eval or {}).get('score'), 0.0))
    decision = TradeDecision(
        strategy=strategy,
        side=normalize_trade_side(signal),
        confidence=confidence,
        score=score,
    )
    return decision.to_dict()