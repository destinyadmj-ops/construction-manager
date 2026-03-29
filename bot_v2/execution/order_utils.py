from __future__ import annotations


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def extract_fill_price(resp: dict | None) -> float:
    payload = resp or {}
    candidates = []

    for root_key in ('data', 'result'):
        root = payload.get(root_key)
        if isinstance(root, dict):
            candidates.append(root)
            nested = root.get('data')
            if isinstance(nested, dict):
                candidates.append(nested)

    candidates.append(payload)

    for item in candidates:
        for key in ('avgPrice', 'fillPrice', 'priceAvg', 'price'):
            parsed = _safe_float(item.get(key), 0.0)
            if parsed > 0:
                return parsed
    return 0.0