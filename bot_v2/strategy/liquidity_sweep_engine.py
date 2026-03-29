from typing import Any


class LiquiditySweepEngine:
    def __init__(self, lookback: int = 20):
        self.lookback = lookback

    def _extract_series(self, candles: Any, key: str):
        if candles is None:
            return []
        if isinstance(candles, dict):
            value = candles.get(key, [])
            return list(value) if isinstance(value, (list, tuple)) else []
        if isinstance(candles, list):
            extracted = []
            for item in candles:
                if isinstance(item, dict) and key in item:
                    extracted.append(item.get(key))
            return extracted
        try:
            series = candles[key]
        except Exception:
            return []
        if hasattr(series, "tolist"):
            return series.tolist()
        if isinstance(series, (list, tuple)):
            return list(series)
        return []

    def detect(self, candles: Any) -> dict:
        high = self._extract_series(candles, "high")
        low = self._extract_series(candles, "low")
        close = self._extract_series(candles, "close")

        if len(high) < self.lookback + 2 or len(low) < self.lookback + 2 or len(close) < self.lookback + 2:
            return {
                "sweep_low": False,
                "sweep_high": False,
            }

        low_vals = [float(v) for v in low]
        high_vals = [float(v) for v in high]
        close_vals = [float(v) for v in close]

        prev_high = max(high_vals[-(self.lookback + 1):-1])
        prev_low = min(low_vals[-(self.lookback + 1):-1])

        sweep_low = bool(low_vals[-1] < prev_low and close_vals[-1] > prev_low)
        sweep_high = bool(high_vals[-1] > prev_high and close_vals[-1] < prev_high)

        return {
            "sweep_low": sweep_low,
            "sweep_high": sweep_high,
        }